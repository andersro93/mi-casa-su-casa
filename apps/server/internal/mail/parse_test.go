package mail

import (
	"regexp"
	"strings"
	"testing"
)

// Ports the `parseIncomingEmail` block of test/parse-email.test.ts (REF §A3,
// "Email parsing"), plus the cases the Workers deployment never had to cover:
// MIME transfer encodings, non-UTF-8 charsets and Mailgun's own
// authentication headers (REF Part C).

const (
	testEnvelopeFrom = "login@service.example"
	testEnvelopeTo   = "codes@example.com"
)

// rawMessage assembles a raw message with the CRLF line endings SMTP delivers.
func rawMessage(lines ...string) []byte {
	return []byte(strings.Join(lines, "\r\n"))
}

// parseOK parses a fixture that is expected to be well-formed.
func parseOK(t *testing.T, raw []byte, envelopeFrom, envelopeTo string) *Parsed {
	t.Helper()
	parsed, err := Parse(raw, envelopeFrom, envelopeTo)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return parsed
}

func wantString(t *testing.T, name string, got *string, want string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want %q", name, want)
	}
	if *got != want {
		t.Errorf("%s = %q, want %q", name, *got, want)
	}
}

func TestParseFallsBackToStrippedHTMLWhenTextIsUnavailable(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: codes@example.com",
		"Subject: Sign in",
		"Content-Type: text/html; charset=utf-8",
		"",
		"<html><body><p>Your verification code is <strong>123456</strong>.</p></body></html>",
	), testEnvelopeFrom, testEnvelopeTo)

	if !strings.Contains(parsed.TextBody, "Your verification code is 123456") {
		t.Errorf("TextBody = %q, want it to contain the stripped sentence", parsed.TextBody)
	}
}

func TestParseUsesAPlaceholderWhenBothBodiesAreEmpty(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: codes@example.com",
		"Subject: Empty body",
		"",
		"",
	), testEnvelopeFrom, testEnvelopeTo)

	if parsed.TextBody != EmptyBodyPlaceholder {
		t.Errorf("TextBody = %q, want %q", parsed.TextBody, EmptyBodyPlaceholder)
	}
	if parsed.TextBodyTruncated {
		t.Error("TextBodyTruncated = true for an empty body")
	}
}

func TestParseTruncatesVeryLargeBodiesAndFlagsIt(t *testing.T) {
	body := "Your verification code is 123456 " + strings.Repeat("x", MaxTextBodyChars+500)
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: Big",
		"",
		body,
	), testEnvelopeFrom, "casa@example.com")

	if !parsed.TextBodyTruncated {
		t.Error("TextBodyTruncated = false, want true")
	}
	if length := len([]rune(parsed.TextBody)); length > MaxTextBodyChars+20 {
		t.Errorf("len(TextBody) = %d, want at most %d", length, MaxTextBodyChars+20)
	}
	if !strings.HasSuffix(parsed.TextBody, "\n[truncated]") {
		t.Error("TextBody does not end with the truncation marker")
	}
	// The code lives in the first bytes, which is the whole point of cutting
	// the tail rather than refusing the message.
	if !strings.Contains(parsed.TextBody, "123456") {
		t.Error("TextBody lost the verification code to truncation")
	}
}

func TestParseDerivesAStableSyntheticMessageIDWhenTheHeaderIsMissing(t *testing.T) {
	lines := []string{
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: No id",
		"Date: Sun, 10 May 2026 12:00:00 +0000",
		"",
		"Your code is 424242",
	}
	raw := rawMessage(lines...)

	first := parseOK(t, raw, testEnvelopeFrom, "casa@example.com")
	again := parseOK(t, raw, testEnvelopeFrom, "casa@example.com")
	different := parseOK(t,
		[]byte(strings.Replace(string(raw), "424242", "999999", 1)),
		testEnvelopeFrom, "casa@example.com")

	pattern := regexp.MustCompile(`^<synthetic-[0-9a-f]{32}@mi-casa-su-casa>$`)
	if !pattern.MatchString(first.MessageID) {
		t.Errorf("MessageID = %q, want the synthetic form", first.MessageID)
	}
	if again.MessageID != first.MessageID {
		t.Errorf("MessageID = %q on a second parse, want the stable %q", again.MessageID, first.MessageID)
	}
	if different.MessageID == first.MessageID {
		t.Error("a different body produced the same synthetic MessageID")
	}
	if first.TextBodyTruncated {
		t.Error("TextBodyTruncated = true for a one-line body")
	}
}

func TestParseSyntheticMessageIDCoversTheWholeIdentity(t *testing.T) {
	base := []string{
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: No id",
		"Date: Sun, 10 May 2026 12:00:00 +0000",
		"",
		"Your code is 424242",
	}
	reference := parseOK(t, rawMessage(base...), testEnvelopeFrom, "casa@example.com").MessageID

	cases := []struct {
		name         string
		raw          []byte
		envelopeFrom string
		envelopeTo   string
	}{
		{
			name: "a different Subject",
			raw: rawMessage(append([]string{}, "From: Service <login@service.example>",
				"To: casa@example.com", "Subject: Other", "Date: Sun, 10 May 2026 12:00:00 +0000",
				"", "Your code is 424242")...),
			envelopeFrom: testEnvelopeFrom, envelopeTo: "casa@example.com",
		},
		{
			name: "a different Date",
			raw: rawMessage(append([]string{}, "From: Service <login@service.example>",
				"To: casa@example.com", "Subject: No id", "Date: Mon, 11 May 2026 12:00:00 +0000",
				"", "Your code is 424242")...),
			envelopeFrom: testEnvelopeFrom, envelopeTo: "casa@example.com",
		},
		{
			name: "a different envelope sender", raw: rawMessage(base...),
			envelopeFrom: "other@service.example", envelopeTo: "casa@example.com",
		},
		{
			name: "a different envelope recipient", raw: rawMessage(base...),
			envelopeFrom: testEnvelopeFrom, envelopeTo: "other@example.com",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseOK(t, tc.raw, tc.envelopeFrom, tc.envelopeTo).MessageID
			if got == reference {
				t.Errorf("MessageID = %q, want it to differ from the reference", got)
			}
		})
	}
}

func TestParseKeepsTheMessageIDHeaderWhenThereIsOne(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Message-ID:  <abc-123@service.example> ",
		"",
		"Your code is 424242",
	), testEnvelopeFrom, "casa@example.com")

	if parsed.MessageID != "<abc-123@service.example>" {
		t.Errorf("MessageID = %q, want the trimmed header value", parsed.MessageID)
	}
}

func TestParseExposesTheFromAddressAndAuthenticationResults(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Netflix <Info@Account.Netflix.com>",
		"To: casa@example.com",
		"Subject: Code",
		"Authentication-Results: mx.cloudflare.net; dkim=pass header.d=netflix.com; spf=fail smtp.mailfrom=bounce.example; dmarc=pass header.from=netflix.com",
		"",
		"Your code is 123456",
	), testEnvelopeFrom, "casa@example.com")

	wantString(t, "FromAddress", parsed.FromAddress, "info@account.netflix.com")
	wantString(t, "FromHeader", parsed.FromHeader, "Netflix <Info@Account.Netflix.com>")
	if parsed.Authentication == nil {
		t.Fatal("Authentication = nil, want the parsed verdicts")
	}
	mechanism(t, "spf", parsed.Authentication.SPF, "fail")
	mechanism(t, "dkim", parsed.Authentication.DKIM, "pass")
	mechanism(t, "dmarc", parsed.Authentication.DMARC, "pass")
}

func TestParseCarriesTheEnvelopeAndRawSizeThrough(t *testing.T) {
	raw := rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: Code",
		"Date: Sun, 10 May 2026 12:00:00 +0000",
		"",
		"Your code is 123456",
	)
	parsed := parseOK(t, raw, testEnvelopeFrom, "casa@example.com")

	if parsed.EnvelopeFrom != testEnvelopeFrom || parsed.EnvelopeTo != "casa@example.com" {
		t.Errorf("envelope = (%q, %q), want the values handed in", parsed.EnvelopeFrom, parsed.EnvelopeTo)
	}
	if parsed.RawSize != len(raw) {
		t.Errorf("RawSize = %d, want %d", parsed.RawSize, len(raw))
	}
	wantString(t, "Subject", parsed.Subject, "Code")
	wantString(t, "DateHeader", parsed.DateHeader, "Sun, 10 May 2026 12:00:00 +0000")
	wantString(t, "HouseholdSlug", parsed.HouseholdSlug, "casa")
}

func TestParseLeavesAbsentHeadersNil(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"To: casa@example.com",
		"",
		"Your code is 123456",
	), testEnvelopeFrom, "casa@example.com")

	if parsed.FromHeader != nil {
		t.Errorf("FromHeader = %q, want nil", *parsed.FromHeader)
	}
	if parsed.FromAddress != nil {
		t.Errorf("FromAddress = %q, want nil", *parsed.FromAddress)
	}
	if parsed.Subject != nil {
		t.Errorf("Subject = %q, want nil", *parsed.Subject)
	}
	if parsed.DateHeader != nil {
		t.Errorf("DateHeader = %q, want nil", *parsed.DateHeader)
	}
	if parsed.Authentication != nil {
		t.Errorf("Authentication = %+v, want nil", parsed.Authentication)
	}
}

func TestParseIgnoresAnUnparseableFromHeader(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: not an address at all",
		"To: casa@example.com",
		"",
		"Your code is 123456",
	), testEnvelopeFrom, "casa@example.com")

	wantString(t, "FromHeader", parsed.FromHeader, "not an address at all")
	if parsed.FromAddress != nil {
		t.Errorf("FromAddress = %q, want nil for an unparseable From", *parsed.FromAddress)
	}
}

func TestParsePrefersTheTextPartOfAMultipartAlternative(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: Both bodies",
		`Content-Type: multipart/alternative; boundary="b1"`,
		"",
		"--b1",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Your code is 111111",
		"--b1",
		"Content-Type: text/html; charset=utf-8",
		"",
		"<p>Your code is 222222</p>",
		"--b1--",
		"",
	), testEnvelopeFrom, "casa@example.com")

	if parsed.TextBody != "Your code is 111111" {
		t.Errorf("TextBody = %q, want the text/plain alternative", parsed.TextBody)
	}
}

func TestParseWalksNestedMultipartsAndSkipsAttachments(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: Nested",
		`Content-Type: multipart/mixed; boundary="outer"`,
		"",
		"--outer",
		`Content-Type: multipart/alternative; boundary="inner"`,
		"",
		"--inner",
		"Content-Type: text/html; charset=utf-8",
		"",
		"<p>Your code is 222222</p>",
		"--inner",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Your code is 111111",
		"--inner--",
		"--outer",
		"Content-Type: text/plain; charset=utf-8",
		`Content-Disposition: attachment; filename="notes.txt"`,
		"",
		"Attached text is not the body",
		"--outer--",
		"",
	), testEnvelopeFrom, "casa@example.com")

	if parsed.TextBody != "Your code is 111111" {
		t.Errorf("TextBody = %q, want only the inline text part", parsed.TextBody)
	}
}

func TestParseFallsBackToHTMLInsideAMultipart(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: HTML only",
		`Content-Type: multipart/alternative; boundary="b1"`,
		"",
		"--b1",
		"Content-Type: text/html; charset=utf-8",
		"",
		"<p>Your code is <b>222222</b></p>",
		"--b1--",
		"",
	), testEnvelopeFrom, "casa@example.com")

	if !strings.Contains(parsed.TextBody, "Your code is 222222") {
		t.Errorf("TextBody = %q, want the stripped HTML part", parsed.TextBody)
	}
}

func TestParseDecodesQuotedPrintableBodies(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: QP",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: quoted-printable",
		"",
		"Your verification code is 123456 and this line is soft-wrapped=",
		"here.",
	), testEnvelopeFrom, "casa@example.com")

	want := "Your verification code is 123456 and this line is soft-wrappedhere."
	if parsed.TextBody != want {
		t.Errorf("TextBody = %q, want %q", parsed.TextBody, want)
	}
}

func TestParseDecodesBase64Bodies(t *testing.T) {
	// base64("Your code is 424242")
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: B64",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: base64",
		"",
		"WW91ciBjb2RlIGlzIDQyNDI0Mg==",
		"",
	), testEnvelopeFrom, "casa@example.com")

	if parsed.TextBody != "Your code is 424242" {
		t.Errorf("TextBody = %q, want the decoded body", parsed.TextBody)
	}
}

func TestParseDecodesISO88591SubjectsAndBodies(t *testing.T) {
	raw := rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"Subject: =?ISO-8859-1?Q?Din_kode_til_F=E5rup?=",
		"Content-Type: text/plain; charset=ISO-8859-1",
		"",
		"Din kode er 123456 for F\xe5rup",
	)
	parsed := parseOK(t, raw, testEnvelopeFrom, "casa@example.com")

	wantString(t, "Subject", parsed.Subject, "Din kode til Fårup")
	if parsed.TextBody != "Din kode er 123456 for Fårup" {
		t.Errorf("TextBody = %q, want the ISO-8859-1 body decoded to UTF-8", parsed.TextBody)
	}
}

func TestParseReadsMailgunAuthenticationHeaders(t *testing.T) {
	cases := []struct {
		name       string
		headers    []string
		spf        string
		dkim       string
		dmarc      string
		wantReason string
	}{
		{
			name:       "X-Mailgun-Spf is lower-cased into spf",
			headers:    []string{"X-Mailgun-Spf: Pass"},
			spf:        "pass",
			wantReason: "callers compare against the literal \"pass\"",
		},
		{
			name:       "X-Mailgun-Dkim-Check-Result is lower-cased into dkim",
			headers:    []string{"X-Mailgun-Dkim-Check-Result: Fail"},
			dkim:       "fail",
			wantReason: "Mailgun writes Pass/Fail, the domain compares lower-case",
		},
		{
			name:       "a softfail verdict survives verbatim",
			headers:    []string{"X-Mailgun-Spf: SoftFail"},
			spf:        "softfail",
			wantReason: "softfail is not a pass and the reason string has to say so",
		},
		{
			name: "both Mailgun headers together",
			headers: []string{
				"X-Mailgun-Spf: Neutral",
				"X-Mailgun-Dkim-Check-Result: Pass",
			},
			spf:        "neutral",
			dkim:       "pass",
			wantReason: "Mailgun evaluates the two independently",
		},
		{
			name: "Mailgun wins over Authentication-Results for spf and dkim",
			headers: []string{
				"Authentication-Results: mx.mailgun.org; spf=fail; dkim=fail; dmarc=pass",
				"X-Mailgun-Spf: Pass",
				"X-Mailgun-Dkim-Check-Result: Pass",
			},
			spf:        "pass",
			dkim:       "pass",
			dmarc:      "pass",
			wantReason: "Mailgun is the MTA that actually ran the checks; dmarc still comes from the header",
		},
		{
			name: "an Authentication-Results header alone still supplies dmarc",
			headers: []string{
				"Authentication-Results: mx.mailgun.org; dmarc=fail",
			},
			dmarc:      "fail",
			wantReason: "Mailgun has no DMARC header of its own",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lines := append([]string{
				"From: Service <login@service.example>",
				"To: casa@example.com",
				"Subject: Code",
			}, tc.headers...)
			lines = append(lines, "", "Your code is 123456")

			parsed := parseOK(t, rawMessage(lines...), testEnvelopeFrom, "casa@example.com")
			if parsed.Authentication == nil {
				t.Fatalf("Authentication = nil, want a verdict (%s)", tc.wantReason)
			}
			mechanism(t, "spf", parsed.Authentication.SPF, tc.spf)
			mechanism(t, "dkim", parsed.Authentication.DKIM, tc.dkim)
			mechanism(t, "dmarc", parsed.Authentication.DMARC, tc.dmarc)
		})
	}
}

func TestParseLeavesAuthenticationNilWithoutAnySource(t *testing.T) {
	parsed := parseOK(t, rawMessage(
		"From: Service <login@service.example>",
		"To: casa@example.com",
		"",
		"Your code is 123456",
	), testEnvelopeFrom, "casa@example.com")

	if parsed.Authentication != nil {
		t.Errorf("Authentication = %+v, want nil so domain.Verdict trusts the match", parsed.Authentication)
	}
}

func TestParseExtractsTheHouseholdSlug(t *testing.T) {
	cases := []struct {
		name       string
		envelopeTo string
		want       string
		wantReason string
	}{
		{
			name: "a plain local part is the slug", envelopeTo: "casa@example.com", want: "casa",
			wantReason: "the local part addresses the household",
		},
		{
			name: "hyphens are allowed", envelopeTo: "my-casa@example.com", want: "my-casa",
			wantReason: "household slugs may contain hyphens (REF §A3, household slug)",
		},
		{
			name: "an upper-case local part is lower-cased", envelopeTo: "CASA@Example.com", want: "casa",
			wantReason: "parse.ts lower-cases the whole address before testing the pattern",
		},
		{
			name: "surrounding whitespace is trimmed", envelopeTo: "  casa@example.com  ", want: "casa",
			wantReason: "the same trim the TypeScript did",
		},
		{
			name: "a plus tag has no slug", envelopeTo: "casa+netflix@example.com", want: "",
			wantReason: "'+' is outside ^[a-z0-9-]+$, and a tagged address is not a household",
		},
		{
			name: "a dot has no slug", envelopeTo: "casa.two@example.com", want: "",
			wantReason: "'.' is outside the slug alphabet",
		},
		{
			name: "an empty local part has no slug", envelopeTo: "@example.com", want: "",
			wantReason: "there is nothing to address",
		},
		{
			name: "an empty recipient has no slug", envelopeTo: "", want: "",
			wantReason: "an envelope without a recipient cannot name a household",
		},
		{
			name: "an underscore has no slug", envelopeTo: "casa_two@example.com", want: "",
			wantReason: "'_' is outside the slug alphabet",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parsed := parseOK(t, rawMessage(
				"From: Service <login@service.example>",
				"To: casa@example.com",
				"",
				"Your code is 123456",
			), testEnvelopeFrom, tc.envelopeTo)

			if tc.want == "" {
				if parsed.HouseholdSlug != nil {
					t.Errorf("HouseholdSlug = %q, want nil (%s)", *parsed.HouseholdSlug, tc.wantReason)
				}
				return
			}
			wantString(t, "HouseholdSlug", parsed.HouseholdSlug, tc.want)
		})
	}
}

func TestParseRejectsAMessageWithUnreadableHeaders(t *testing.T) {
	if _, err := Parse([]byte("this is not a header\r\n\r\nbody"), testEnvelopeFrom, testEnvelopeTo); err == nil {
		t.Error("Parse returned no error for a message without a header block")
	}
}
