package mail

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	netmail "net/mail"
	"regexp"
	"strings"

	message "github.com/emersion/go-message"
	"github.com/emersion/go-message/charset"

	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
)

// Ports parseIncomingEmail from src/server/email/parse.ts (REF §A3, "Email
// parsing") and the authentication half of REF Part C, "Mailgun inbound
// contract".
//
// The TypeScript ran on postal-mime inside a Worker; here go-message does the
// MIME work. The observable contract is the same: the same body preference,
// the same truncation, the same synthetic Message-ID — a message redelivered
// after the migration must still de-duplicate against the row the Workers
// deployment wrote.

// MaxTextBodyChars is where a body is cut. Verification codes live in the
// first few KB; the rest is footer, and storing megabytes of it per message
// would only cost retention.
const MaxTextBodyChars = 64 * 1024

// EmptyBodyPlaceholder stands in for a message with no readable body at all,
// so text_body (NOT NULL) always has something and the inbox row is not a
// blank card.
const EmptyBodyPlaceholder = "[empty email body]"

// TruncationMarker is appended to a body that was cut, so a reader can tell a
// short message from a shortened one.
const TruncationMarker = "\n[truncated]"

// Mailgun's own authentication headers (REF Part C). They are present only
// when Mailgun evaluated the mechanism, and they are the verdict of the MTA
// that actually received the message — so they outrank anything an upstream
// hop wrote into Authentication-Results.
const (
	MailgunSPFHeader  = "X-Mailgun-Spf"
	MailgunDKIMHeader = "X-Mailgun-Dkim-Check-Result"
)

// maxMultipartDepth bounds how deep the part walk goes. A hostile message can
// nest multiparts indefinitely; the body of a real one is never this far down.
const maxMultipartDepth = 20

// slugPattern is the local part a household slug may be read from. It is
// applied after lower-casing, exactly as the TypeScript did.
var slugPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

// addressParser reads the From header. The charset reader is go-message's, so
// a display name encoded as =?ISO-8859-1?Q?…?= does not defeat the parse and
// cost us the address behind it.
var addressParser = netmail.AddressParser{
	WordDecoder: &mime.WordDecoder{CharsetReader: charset.Reader},
}

// Parsed is an inbound email after parsing: everything classification and
// storage need, and nothing about the transport that delivered it.
//
// DateHeader is the raw header value, kept for display only. It never becomes
// received_at: a sender that puts the year 2099 in its Date header would
// otherwise sit at the top of the inbox forever and outlive retention.
type Parsed struct {
	EnvelopeFrom string
	EnvelopeTo   string
	// HouseholdSlug is nil when the recipient address carried none, which is
	// one of the reasons a message ends up quarantined.
	HouseholdSlug *string
	// FromHeader is the raw From header, as displayed in the inbox.
	FromHeader *string
	// FromAddress is the lower-cased address parsed out of the From header,
	// used as the first match candidate during classification.
	FromAddress *string
	// Authentication is what the receiving MTA asserted (nil when the message
	// carried neither an Authentication-Results header nor Mailgun's own).
	Authentication *domain.Authentication
	Subject        *string
	// MessageID is the RFC 5322 Message-ID, or a deterministic synthetic one
	// when the message carried none — a redelivery of the same message must
	// still be recognised as a duplicate.
	MessageID  string
	DateHeader *string
	TextBody   string
	// TextBodyTruncated records that TextBody was cut at MaxTextBodyChars.
	TextBodyTruncated bool
	RawSize           int
}

// Parse turns a raw RFC 5322 message plus its SMTP envelope into a Parsed.
//
// It fails only when the header block itself is unreadable — the caller
// rejects such a message permanently. Everything softer is absorbed: an
// unknown charset or transfer encoding leaves the affected part as the bytes
// that were there, and a malformed part inside a multipart ends the walk
// rather than the parse, because a message whose first part carries the code
// is still worth storing.
func Parse(raw []byte, envelopeFrom, envelopeTo string) (*Parsed, error) {
	entity, err := message.Read(bytes.NewReader(raw))
	if entity == nil {
		return nil, fmt.Errorf("mail: read message: %w", err)
	}

	text, html := collectBodies(entity)
	textBody, truncated := resolveTextBody(text, html)

	header := &entity.Header
	fromHeader := headerValue(header, "From")
	subject := decodedHeader(header, "Subject")
	dateHeader := headerValue(header, "Date")

	messageID := strings.TrimSpace(header.Get("Message-Id"))
	if messageID == "" {
		messageID = syntheticMessageID(envelopeFrom, envelopeTo, dateHeader, subject, textBody)
	}

	return &Parsed{
		EnvelopeFrom:      envelopeFrom,
		EnvelopeTo:        envelopeTo,
		HouseholdSlug:     extractHouseholdSlug(envelopeTo),
		FromHeader:        fromHeader,
		FromAddress:       parseFromAddress(fromHeader),
		Authentication:    parseAuthentication(header),
		Subject:           subject,
		MessageID:         messageID,
		DateHeader:        dateHeader,
		TextBody:          textBody,
		TextBodyTruncated: truncated,
		RawSize:           len(raw),
	}, nil
}

// collectBodies walks the message and returns its inline text/plain and
// text/html parts in document order.
//
// Parts marked as attachments are skipped: postal-mime treated those as
// attachments rather than body, and a text/plain attachment full of numbers
// must not be mined for a verification code.
func collectBodies(entity *message.Entity) (text, html []string) {
	walkEntity(entity, 0, &text, &html)
	return text, html
}

func walkEntity(entity *message.Entity, depth int, text, html *[]string) {
	if depth > maxMultipartDepth {
		return
	}

	if parts := entity.MultipartReader(); parts != nil {
		for {
			part, err := parts.NextPart()
			if err != nil {
				// io.EOF ends a well-formed multipart; anything else is a
				// truncated or malformed one, and the parts read so far are
				// still the best body available.
				return
			}
			walkEntity(part, depth+1, text, html)
		}
	}

	if disposition, _, err := entity.Header.ContentDisposition(); err == nil &&
		strings.EqualFold(disposition, "attachment") {
		return
	}

	mediaType, _, _ := entity.Header.ContentType()
	switch strings.ToLower(mediaType) {
	case "text/plain":
		*text = append(*text, readBody(entity))
	case "text/html":
		*html = append(*html, readBody(entity))
	}
}

// readBody reads one decoded part. A read error yields whatever was decoded
// before it — a body cut short by a broken encoding still beats no body.
func readBody(entity *message.Entity) string {
	body, _ := io.ReadAll(entity.Body)
	return string(body)
}

// resolveTextBody applies the TypeScript's
// `text?.trim() || (html ? stripHtml(html) : "") || "[empty email body]"`,
// then the truncation. Multiple parts of the same type are joined with a
// newline, the way postal-mime concatenated them.
func resolveTextBody(text, html []string) (body string, truncated bool) {
	full := strings.TrimSpace(strings.Join(text, "\n"))
	if full == "" && len(html) > 0 {
		full = StripHTML(strings.Join(html, "\n"))
	}
	if full == "" {
		full = EmptyBodyPlaceholder
	}

	// Counted in runes rather than bytes: the TypeScript cut at a JavaScript
	// string length, so a body of accented text has to survive the same
	// number of characters here, not the same number of bytes.
	runes := []rune(full)
	if len(runes) <= MaxTextBodyChars {
		return full, false
	}
	return string(runes[:MaxTextBodyChars]) + TruncationMarker, true
}

// syntheticMessageID is the deterministic id given to a message that carried
// no Message-ID: the same message delivered twice hashes to the same value,
// so the (household, message_id) uniqueness still de-duplicates it.
//
// The inputs and their NUL separator are the TypeScript's, byte for byte —
// changing them would make every such message look new again.
func syntheticMessageID(from, to string, date, subject *string, body string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		from,
		to,
		orEmpty(date),
		orEmpty(subject),
		body,
	}, "\x00")))
	return "<synthetic-" + hex.EncodeToString(sum[:])[:32] + "@mi-casa-su-casa>"
}

// extractHouseholdSlug reads the household out of the envelope recipient:
// `casa@example.com` addresses the household `casa`. Anything outside the
// slug alphabet — a `+tag`, a dot, an underscore — addresses no household,
// and the message is quarantined rather than guessed at.
func extractHouseholdSlug(address string) *string {
	normalized := strings.ToLower(strings.TrimSpace(address))
	localPart := strings.TrimSpace(strings.SplitN(normalized, "@", 2)[0])
	if localPart == "" || !slugPattern.MatchString(localPart) {
		return nil
	}
	return &localPart
}

// parseFromAddress pulls the bare address out of the From header. An
// unparseable header yields nil, which simply leaves the envelope sender as
// the only classification candidate.
func parseFromAddress(fromHeader *string) *string {
	if fromHeader == nil {
		return nil
	}
	addresses, err := addressParser.ParseList(*fromHeader)
	if err != nil || len(addresses) == 0 {
		return nil
	}
	address := strings.ToLower(strings.TrimSpace(addresses[0].Address))
	if address == "" {
		return nil
	}
	return &address
}

// parseAuthentication combines the two sources of sender authentication:
// every Authentication-Results header on the message, then Mailgun's own
// verdicts, which override it for the mechanisms they cover. Mailgun is the
// MTA that ran the checks; an Authentication-Results line could have been
// written by any hop, including the sender.
//
// DMARC has no Mailgun header, so it only ever comes from
// Authentication-Results. nil means nothing asserted anything, which
// domain.Verdict treats as "nothing to distrust".
func parseAuthentication(header *message.Header) *domain.Authentication {
	auth := ParseAuthenticationResults(header.Values("Authentication-Results"))

	if spf := mechanismVerdict(header, MailgunSPFHeader); spf != nil {
		if auth == nil {
			auth = &domain.Authentication{}
		}
		auth.SPF = spf
	}
	if dkim := mechanismVerdict(header, MailgunDKIMHeader); dkim != nil {
		if auth == nil {
			auth = &domain.Authentication{}
		}
		auth.DKIM = dkim
	}
	return auth
}

// mechanismVerdict reads one Mailgun verdict header, lower-cased so callers
// can compare against the literal "pass".
func mechanismVerdict(header *message.Header, name string) *string {
	verdict := strings.ToLower(strings.TrimSpace(header.Get(name)))
	if verdict == "" {
		return nil
	}
	return &verdict
}

// headerValue returns a header verbatim, or nil when the message has no such
// header — the difference the TypeScript drew with `?? null`.
func headerValue(header *message.Header, name string) *string {
	if !header.Has(name) {
		return nil
	}
	value := header.Get(name)
	return &value
}

// decodedHeader is headerValue with RFC 2047 encoded words decoded, for the
// headers that are displayed rather than matched on. An undecodable charset
// leaves the raw value, which is still better than dropping the header.
func decodedHeader(header *message.Header, name string) *string {
	if !header.Has(name) {
		return nil
	}
	value, err := header.Text(name)
	if err != nil {
		value = header.Get(name)
	}
	return &value
}

func orEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
