package domain

import "testing"

func auth(spf, dkim, dmarc string) *Authentication {
	value := func(s string) *string {
		if s == "" {
			return nil
		}
		return &s
	}
	return &Authentication{SPF: value(spf), DKIM: value(dkim), DMARC: value(dmarc)}
}

// Ports the `authenticationVerdict` block of test/classify-email.test.ts
// (REF §A3, "Classification" step 5).
func TestVerdict(t *testing.T) {
	cases := []struct {
		name       string
		auth       *Authentication
		source     Source
		trusted    bool
		reason     string
		wantReason string
	}{
		{
			name:       "no Authentication-Results header at all, header source",
			auth:       nil,
			source:     SourceHeader,
			trusted:    true,
			wantReason: "nothing to check means nothing to distrust; the provider rule already matched",
		},
		{
			name:    "no Authentication-Results header at all, envelope source",
			auth:    nil,
			source:  SourceEnvelope,
			trusted: true,
		},
		{
			name:       "dmarc=fail is never trusted, even with spf and dkim passing",
			auth:       auth("pass", "pass", "fail"),
			source:     SourceEnvelope,
			trusted:    false,
			reason:     "dmarc=fail",
			wantReason: "an explicit DMARC failure is the domain owner's own verdict",
		},
		{
			name:       "dmarc=fail outranks a passing dkim on the header source too",
			auth:       auth("pass", "pass", "fail"),
			source:     SourceHeader,
			trusted:    false,
			reason:     "dmarc=fail",
			wantReason: "the DMARC check precedes the per-source checks",
		},
		{
			name:       "header source trusts dkim=pass",
			auth:       auth("fail", "pass", "none"),
			source:     SourceHeader,
			trusted:    true,
			wantReason: "the From header is what DKIM signs; SPF covers the envelope, not this",
		},
		{
			name:    "header source trusts dmarc=pass",
			auth:    auth("fail", "none", "pass"),
			source:  SourceHeader,
			trusted: true,
		},
		{
			name:       "header source rejects spf-only authentication",
			auth:       auth("pass", "none", "none"),
			source:     SourceHeader,
			trusted:    false,
			reason:     "From header not authenticated (dkim=none, dmarc=none)",
			wantReason: "SPF says nothing about the From header a rule matched on",
		},
		{
			name:       "header source reports missing verdicts as none",
			auth:       auth("pass", "", ""),
			source:     SourceHeader,
			trusted:    false,
			reason:     "From header not authenticated (dkim=none, dmarc=none)",
			wantReason: "an absent mechanism reads as none, exactly like the TypeScript nullish coalesce",
		},
		{
			name:       "header source reports the actual verdicts it saw",
			auth:       auth("pass", "fail", "none"),
			source:     SourceHeader,
			trusted:    false,
			reason:     "From header not authenticated (dkim=fail, dmarc=none)",
			wantReason: "the quarantine reason has to say what actually happened",
		},
		{
			name:       "envelope source trusts spf=pass",
			auth:       auth("pass", "none", "none"),
			source:     SourceEnvelope,
			trusted:    true,
			wantReason: "SPF authenticates the envelope sender the rule matched on",
		},
		{
			name:       "envelope source rejects spf=softfail",
			auth:       auth("softfail", "pass", "none"),
			source:     SourceEnvelope,
			trusted:    false,
			reason:     "envelope sender not authenticated (spf=softfail)",
			wantReason: "only an outright pass counts; softfail is not a pass",
		},
		{
			name:       "envelope source reports a missing spf as none",
			auth:       auth("", "pass", "pass"),
			source:     SourceEnvelope,
			trusted:    false,
			reason:     "envelope sender not authenticated (spf=none)",
			wantReason: "a DKIM pass does not vouch for the envelope address",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			trusted, reason := Verdict(tc.auth, tc.source)
			if trusted != tc.trusted {
				t.Fatalf("Verdict trusted = %v, want %v (%s)", trusted, tc.trusted, tc.wantReason)
			}
			if reason != tc.reason {
				t.Errorf("Verdict reason = %q, want %q (%s)", reason, tc.reason, tc.wantReason)
			}
		})
	}
}

// A trusted verdict carries no reason: the caller writes the reason straight
// into the quarantine row, and an empty string is how it knows there is none.
func TestVerdict_TrustedHasNoReason(t *testing.T) {
	if _, reason := Verdict(auth("pass", "pass", "pass"), SourceEnvelope); reason != "" {
		t.Errorf("trusted verdict carried reason %q, want none", reason)
	}
}
