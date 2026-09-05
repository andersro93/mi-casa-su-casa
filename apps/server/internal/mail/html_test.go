package mail

import (
	"strings"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
)

// Ports the `stripHtml` block of test/extract-code.test.ts: CSS colours such
// as #123456 and script literals must not survive into the text the code
// extractor reads.
func TestStripHTML_DropsBlocksDecodesEntitiesAndKeepsTheCode(t *testing.T) {
	html := "<html><head><style>.btn{color:#123456;width:600px}</style></head>" +
		"<body><p>Hello&nbsp;there, your code is&#160;<b>778899</b> &amp; expires soon.</p>" +
		"<script>var x = 999999;</script></body></html>"

	text := StripHTML(html)

	if strings.Contains(text, "123456") {
		t.Errorf("StripHTML kept the CSS colour: %q", text)
	}
	if strings.Contains(text, "999999") {
		t.Errorf("StripHTML kept the script literal: %q", text)
	}
	if want := "Hello there, your code is 778899 & expires soon."; !strings.Contains(text, want) {
		t.Errorf("StripHTML = %q, want it to contain %q", text, want)
	}
	code, ok := domain.ExtractVerificationCode(text)
	if !ok || code != "778899" {
		t.Errorf("ExtractVerificationCode(StripHTML(html)) = (%q, %v), want (\"778899\", true)", code, ok)
	}
}

func TestStripHTML(t *testing.T) {
	cases := []struct {
		name       string
		html       string
		want       string
		wantReason string
	}{
		{
			name:       "comments are removed",
			html:       "<p>before<!-- your code is 424242 -->after</p>",
			want:       "before after",
			wantReason: "a hidden comment must not be read as the body's code",
		},
		{
			name:       "a title block goes with its contents",
			html:       "<title>Code 111111</title><p>hi</p>",
			want:       "hi",
			wantReason: "the subject line is carried separately; the title would double it",
		},
		{
			name:       "tags become spaces rather than vanishing",
			html:       "<p>one</p><p>two</p>",
			want:       "one two",
			wantReason: "concatenating without a separator would weld two words into one token",
		},
		{
			name:       "whitespace collapses and the result is trimmed",
			html:       "  <p>\n\n  a \t b \n</p>  ",
			want:       "a b",
			wantReason: "the extractor's 80-character window must not be spent on layout whitespace",
		},
		{
			name: "plain text without markup is returned as is",
			html: "no markup here",
			want: "no markup here",
		},
		{
			name: "empty input stays empty",
			html: "",
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StripHTML(tc.html); got != tc.want {
				t.Errorf("StripHTML(%q) = %q, want %q (%s)", tc.html, got, tc.want, tc.wantReason)
			}
		})
	}
}

func TestDecodeEntities(t *testing.T) {
	cases := []struct {
		name       string
		in         string
		want       string
		wantReason string
	}{
		{name: "named entities", in: "a&nbsp;b&amp;c&lt;d&gt;e&quot;f&apos;g", want: "a b&c<d>e\"f'g"},
		{name: "numeric decimal", in: "&#39;&#65;", want: "'A"},
		{name: "numeric hex", in: "&#x27;&#X41;", want: "'A"},
		{
			name:       "entity names are matched case-insensitively",
			in:         "&AMP;&NBSP;",
			want:       "& ",
			wantReason: "the TypeScript original lower-cases the captured name before the lookup",
		},
		{
			name:       "unknown entities are left alone",
			in:         "&copyright;&unknown;",
			want:       "&copyright;&unknown;",
			wantReason: "dropping them would silently mangle the body text",
		},
		{
			name: "a bare ampersand is left alone",
			in:   "a & b",
			want: "a & b",
		},
		{
			name:       "a non-breaking space entity decodes to U+00A0",
			in:         "a&#160;b",
			want:       "a b",
			wantReason: "StripHTML collapses it afterwards; decoding must not do it early",
		},
		{
			name: "astral code points",
			in:   "&#x1f600;",
			want: "\U0001f600",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := DecodeEntities(tc.in); got != tc.want {
				t.Errorf("DecodeEntities(%q) = %q, want %q (%s)", tc.in, got, tc.want, tc.wantReason)
			}
		})
	}
}
