// Package mail holds the parsing side of Mi Casa Su Casa's inbound email
// path: turning what an MTA handed us into the plain text and the
// authentication verdict the domain rules reason about.
//
// It is a port of src/server/email/parse.ts. Everything here is pure — the
// transport (Mailgun's webhook) lives elsewhere, so these rules stay table
// tested.
package mail

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
)

// Ports the stripHtml and decodeHtmlEntities halves of
// src/server/email/parse.ts (REF §A3, "Email parsing").

// jsWhitespace is JavaScript's `\s` written out for RE2, which only knows the
// ASCII five. It matters here because an HTML mail's `&#160;` decodes to a
// non-breaking space, and the original collapsed that away along with the
// rest. It is domain's constant rather than a second copy: the two must not
// diverge, and this package already depends on domain.
const jsWhitespace = domain.JSWhitespace

var (
	commentPattern = regexp.MustCompile(`(?s)<!--.*?-->`)
	// blockPattern removes the elements whose contents are not body text.
	// The TypeScript matched all four with one backreferenced group,
	// `<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>`; RE2 has no
	// backreferences, so the group is spelled out as four alternatives in the
	// same order, which scans left to right the same way.
	blockPattern = regexp.MustCompile(`(?is)` + strings.Join([]string{
		`<style\b[^>]*>.*?</style` + jsWhitespace + `*>`,
		`<script\b[^>]*>.*?</script` + jsWhitespace + `*>`,
		`<head\b[^>]*>.*?</head` + jsWhitespace + `*>`,
		`<title\b[^>]*>.*?</title` + jsWhitespace + `*>`,
	}, "|"))
	tagPattern        = regexp.MustCompile(`<[^>]+>`)
	whitespacePattern = regexp.MustCompile(jsWhitespace + `+`)
	entityPattern     = regexp.MustCompile(`(?i)&(#x[0-9a-f]+|#[0-9]+|[a-z]+);`)
)

// namedEntities is the small table the original carried: enough for the text
// an HTML mail actually contains, and nothing more. Its "#39" key is dropped
// here because the numeric branch below already decodes `&#39;` to the same
// apostrophe.
var namedEntities = map[string]string{
	"nbsp": " ",
	"amp":  "&",
	"lt":   "<",
	"gt":   ">",
	"quot": `"`,
	"apos": "'",
}

// StripHTML turns HTML into plain text good enough for code extraction:
// style/script blocks and comments are removed entirely (CSS colours like
// #123456 must not look like codes), tags become spaces, entities are
// decoded.
//
// Tags become a space rather than nothing so that "<p>one</p><p>two</p>" does
// not weld into one token the extractor would then try to read as a code.
func StripHTML(html string) string {
	withoutBlocks := blockPattern.ReplaceAllString(commentPattern.ReplaceAllString(html, " "), " ")
	text := DecodeEntities(tagPattern.ReplaceAllString(withoutBlocks, " "))
	// Only spaces are left as whitespace after the collapse, so trimming
	// spaces is exactly the original's .trim().
	return strings.Trim(whitespacePattern.ReplaceAllString(text, " "), " ")
}

// DecodeEntities resolves the named, decimal and hexadecimal HTML entities
// the original knew about. Anything else is left exactly as written: dropping
// an unknown entity would silently mangle the body text.
//
// Divergence from the TypeScript: an out-of-range or surrogate code point is
// left as written too. String.fromCodePoint threw a RangeError on the first
// and produced a lone surrogate on the second, neither of which a Go string
// can hold — and a malformed entity in a stranger's email must not be able to
// take the handler down.
func DecodeEntities(value string) string {
	return entityPattern.ReplaceAllStringFunc(value, func(whole string) string {
		entity := strings.ToLower(whole[1 : len(whole)-1])

		if rest, isHex := strings.CutPrefix(entity, "#x"); isHex {
			return codePoint(rest, 16, whole)
		}
		if rest, isDecimal := strings.CutPrefix(entity, "#"); isDecimal {
			return codePoint(rest, 10, whole)
		}
		if decoded, known := namedEntities[entity]; known {
			return decoded
		}
		return whole
	})
}

// codePoint renders digits in the given base as a character, falling back to
// the entity as written when it does not name one.
func codePoint(digits string, base int, whole string) string {
	value, err := strconv.ParseInt(digits, base, 32)
	if err != nil || value < 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF) {
		return whole
	}
	return string(rune(value))
}
