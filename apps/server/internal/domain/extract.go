package domain

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Ports src/server/domain/extract-code.ts (REF §A3, "Code extraction").
//
// Extracts a one-time verification code from an email body.
//
// Strategy:
//  1. Look for a code keyword ("verification code", "passcode", "OTP",
//     "code", …) and scan a short window after it for the first plausible
//     token: digits (optionally grouped with a space or hyphen) or an
//     uppercase alphanumeric token that contains at least one digit.
//  2. Without a keyword, fall back to a conservative scan: return the code
//     only when the body contains exactly one 6-digit token. Anything else
//     yields no code rather than a confident wrong one.
//
// Two things in the original do not survive a literal translation, because
// Go's regexp engine is RE2:
//   - JavaScript's `\s` also matches NBSP and the other Unicode spaces, while
//     Go's matches only the ASCII five. A "verification code" in an HTML
//     mail would otherwise stop being a keyword, so the class is spelled out
//     as JSWhitespace below.
//   - the piece split used lookbehind and lookahead, which RE2 has not; it is
//     a byte loop in splitTokenRun instead.

// JSWhitespace is JavaScript's `\s` written out for RE2, which knows only the
// ASCII five. It is exported because internal/mail needs the identical set to
// collapse whitespace the way the TypeScript stripHtml did — the two were
// separate constants with "keep in sync" comments on both, which is one
// declaration too many for a 28-character character class that must not
// diverge.
const JSWhitespace = `[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

// keywordPattern is the TypeScript KEYWORD_PATTERN, case-insensitive and
// word-bounded. Go's `\b`, like JavaScript's without the `u` flag, is defined
// over ASCII word characters, so "código" still bounds the same way.
var keywordPattern = regexp.MustCompile(
	`(?i)\b(?:(?:verification|verify|security|one[- ]?time|login|log-?in|sign[- ]?in|access|` +
		`confirmation|auth(?:entication|orization)?|2fa|two[- ]factor)` + JSWhitespace + `+` +
		`(?:code|pin|passcode|password|otp)|passcode|otp|pin` + JSWhitespace + `+code|` +
		`code|kode|c[oó]digo|codice)\b`,
)

// windowRunes is how far after a keyword we look for the token. The
// TypeScript sliced 80 UTF-16 units; runes are the closest equivalent that
// does not cut a multi-byte character in half.
const windowRunes = 80

var (
	tokenScan        = regexp.MustCompile(`[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]|[A-Za-z0-9]`)
	groupedPattern   = regexp.MustCompile(`^(\d{3,4})[ -](\d{3,4})$`)
	digitsOnly       = regexp.MustCompile(`^\d+$`)
	yearPattern      = regexp.MustCompile(`^(19|20)\d{2}$`)
	looseCodePattern = regexp.MustCompile(`^[A-Z0-9]{5,10}$`)
	containsDigit    = regexp.MustCompile(`\d`)
	containsUpper    = regexp.MustCompile(`[A-Z]`)
	sixDigitPattern  = regexp.MustCompile(`\b(\d{3}[ -]\d{3}|\d{6})\b`)
)

// ExtractVerificationCode returns the code found in text. ok is false when
// nothing plausible was found — the TypeScript original's null — and code is
// then empty, so a caller that ignores ok cannot store a stale value.
func ExtractVerificationCode(text string) (code string, ok bool) {
	for _, keyword := range keywordPattern.FindAllStringIndex(text, -1) {
		start := keyword[1]
		window := text[start:windowEnd(text, start)]
		if code, ok := scanWindow(window, text, start); ok {
			return code, true
		}
	}
	return fallbackCode(text)
}

// windowEnd is the byte offset windowRunes runes past start, or the end of
// text.
func windowEnd(text string, start int) int {
	end := start
	for n := 0; n < windowRunes && end < len(text); n++ {
		_, size := utf8.DecodeRuneInString(text[end:])
		end += size
	}
	return end
}

// scanWindow returns the first plausible code in window. offset is window's
// byte offset within fullText, which the rejected-symbol check needs: the two
// characters before a token live outside the window when the token starts at
// its very beginning.
func scanWindow(window, fullText string, offset int) (string, bool) {
	for _, match := range tokenScan.FindAllStringIndex(window, -1) {
		if precededByRejectedSymbol(fullText, offset+match[0]) {
			continue
		}
		// A token run can be a sentence fragment ("is valid for 10 minutes");
		// try each word-ish piece inside it in order.
		for _, piece := range splitTokenRun(window[match[0]:match[1]]) {
			trimmed := strings.TrimSpace(piece)
			if trimmed == "" {
				continue
			}
			// Grouped digit pairs like "123 456" or "123-456" are kept intact
			// by the split, so the chunk check sees them whole.
			if code, ok := codeFromChunk(trimmed); ok {
				return code, true
			}
			// Fallback: split into single tokens.
			for _, single := range strings.FieldsFunc(trimmed, isSeparator) {
				if code, ok := codeFromChunk(single); ok {
					return code, true
				}
			}
		}
	}
	return "", false
}

func isSeparator(r rune) bool { return r == ' ' || r == '-' }

// splitTokenRun splits a token run at its space and hyphen separators, except
// where both neighbours are digits — that is a grouped code ("123 456"), not
// two words.
//
// This is the TypeScript
// `/(?<=\d)[ -](?=\D)|(?<=\D)[ -](?=\d)|(?<=\D)[ -](?=\D)/` split, which RE2
// cannot express. Those three alternatives cover every neighbour pairing but
// digit-digit, and each needs a character on both sides, so a separator at
// either end of the run is not a split point either. Runs come from
// tokenScan, whose character class is ASCII, so bytes are characters here.
func splitTokenRun(run string) []string {
	var pieces []string
	last := 0
	for i := 1; i < len(run)-1; i++ {
		if !isSeparator(rune(run[i])) {
			continue
		}
		if isDigitByte(run[i-1]) && isDigitByte(run[i+1]) {
			continue
		}
		pieces = append(pieces, run[last:i])
		last = i + 1
	}
	return append(pieces, run[last:])
}

func isDigitByte(b byte) bool { return b >= '0' && b <= '9' }

// codeFromChunk returns a plausible code when chunk is one, mirroring the
// TypeScript codeFromChunk exactly: grouped digits are joined, a bare run of
// digits must be 4..8 long and not a year, and a mixed token must be short,
// upper-case and contain at least one digit.
func codeFromChunk(chunk string) (string, bool) {
	if grouped := groupedPattern.FindStringSubmatch(chunk); grouped != nil {
		return grouped[1] + grouped[2], true
	}

	if digitsOnly.MatchString(chunk) {
		if len(chunk) < 4 || len(chunk) > 8 {
			return "", false
		}
		if yearPattern.MatchString(chunk) {
			return "", false
		}
		return chunk, true
	}

	if looseCodePattern.MatchString(chunk) &&
		containsDigit.MatchString(chunk) &&
		containsUpper.MatchString(chunk) {
		return chunk, true
	}

	return "", false
}

// precededByRejectedSymbol reports whether the two characters before index
// mark the token as something other than a code: a currency amount, an order
// number, a CSS colour, or the start of a numeric HTML entity.
func precededByRejectedSymbol(text string, index int) bool {
	if index <= 0 {
		return false
	}
	before := text[:index]
	if last, _ := utf8.DecodeLastRuneInString(before); strings.ContainsRune("#$€£+%", last) {
		return true
	}
	return strings.HasSuffix(before, "&#")
}

// fallbackCode is used when no keyword was found. Only the most common OTP
// shape is trusted then — a single, unambiguous 6-digit token (optionally
// grouped 3-3). Zip codes, phone fragments, order numbers and years are
// deliberately not guessed.
func fallbackCode(text string) (string, bool) {
	seen := make(map[string]bool, 2)
	var first string

	for _, match := range sixDigitPattern.FindAllStringSubmatchIndex(text, -1) {
		if precededByRejectedSymbol(text, match[0]) {
			continue
		}
		digits := normalizeDigits(text[match[2]:match[3]])
		if yearPattern.MatchString(digits) {
			continue
		}
		if !seen[digits] {
			seen[digits] = true
			if len(seen) == 1 {
				first = digits
			}
		}
	}

	if len(seen) != 1 {
		return "", false
	}
	return first, true
}

func normalizeDigits(token string) string {
	return strings.Map(func(r rune) rune {
		if isSeparator(r) {
			return -1
		}
		return r
	}, token)
}
