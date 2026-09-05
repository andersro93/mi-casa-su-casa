package mail

import (
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
)

func mechanism(t *testing.T, name string, got *string, want string) {
	t.Helper()
	if want == "" {
		if got != nil {
			t.Errorf("%s = %q, want nil", name, *got)
		}
		return
	}
	if got == nil {
		t.Errorf("%s = nil, want %q", name, want)
		return
	}
	if *got != want {
		t.Errorf("%s = %q, want %q", name, *got, want)
	}
}

// Ports the `parseAuthenticationResults` block of test/parse-email.test.ts
// (REF §A3, "Email parsing").
func TestParseAuthenticationResults(t *testing.T) {
	t.Run("no header at all is nil, not an empty verdict", func(t *testing.T) {
		if got := ParseAuthenticationResults(nil); got != nil {
			t.Errorf("ParseAuthenticationResults(nil) = %+v, want nil", got)
		}
		if got := ParseAuthenticationResults([]string{}); got != nil {
			t.Errorf("ParseAuthenticationResults([]) = %+v, want nil", got)
		}
	})

	t.Run("reads the first verdict per mechanism across all headers", func(t *testing.T) {
		got := ParseAuthenticationResults([]string{
			"mx.cloudflare.net; spf=pass smtp.mailfrom=x; dkim=none",
			"other; dkim=pass; dmarc=fail",
		})
		if got == nil {
			t.Fatal("ParseAuthenticationResults returned nil for two non-empty headers")
		}
		mechanism(t, "spf", got.SPF, "pass")
		mechanism(t, "dkim", got.DKIM, "none")
		mechanism(t, "dmarc", got.DMARC, "fail")
	})

	cases := []struct {
		name       string
		values     []string
		spf        string
		dkim       string
		dmarc      string
		wantReason string
	}{
		{
			name:       "verdicts are lower-cased",
			values:     []string{"mx; SPF=Pass; DKIM=FAIL; DMARC=None"},
			spf:        "pass",
			dkim:       "fail",
			dmarc:      "none",
			wantReason: "callers compare against the literal \"pass\", so casing cannot vary",
		},
		{
			name:       "the first verdict inside one header wins",
			values:     []string{"mx; spf=pass; spf=fail"},
			spf:        "pass",
			wantReason: "the receiving MTA writes its own verdict first",
		},
		{
			name:       "a header with nothing recognisable yields an all-empty verdict",
			values:     []string{"mx.cloudflare.net; none"},
			wantReason: "the header existed, so this is a real \"nothing asserted\", not a missing header",
		},
		{
			name:       "a mechanism name inside a longer word is ignored",
			values:     []string{"mx; xspf=pass; dkim=pass"},
			dkim:       "pass",
			wantReason: "the pattern is word-bounded, as in the TypeScript original",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseAuthenticationResults(tc.values)
			if got == nil {
				t.Fatalf("ParseAuthenticationResults(%q) = nil, want a verdict (%s)", tc.values, tc.wantReason)
			}
			mechanism(t, "spf", got.SPF, tc.spf)
			mechanism(t, "dkim", got.DKIM, tc.dkim)
			mechanism(t, "dmarc", got.DMARC, tc.dmarc)
		})
	}
}

// The parsed verdict feeds domain.Verdict directly, so it has to be the
// domain's own type rather than a package-local copy.
func TestParseAuthenticationResults_FeedsTheVerdict(t *testing.T) {
	auth := ParseAuthenticationResults([]string{"mx; spf=pass; dkim=none; dmarc=none"})
	if trusted, reason := domain.Verdict(auth, domain.SourceEnvelope); !trusted || reason != "" {
		t.Errorf("Verdict(spf=pass, envelope) = (%v, %q), want (true, \"\")", trusted, reason)
	}
	if trusted, reason := domain.Verdict(auth, domain.SourceHeader); trusted ||
		reason != "From header not authenticated (dkim=none, dmarc=none)" {
		t.Errorf("Verdict(spf=pass, header) = (%v, %q), want the unauthenticated-header reason", trusted, reason)
	}
}
