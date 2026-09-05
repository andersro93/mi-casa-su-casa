package domain

import "testing"

// Ports test/extract-code.test.ts — the same table, in the same order, with
// the TypeScript `null` expressed as ok == false (REF §A3, "Code
// extraction").
func TestExtractVerificationCode(t *testing.T) {
	cases := []struct {
		input string
		want  string // "" together with wantOK == false means the TS null
		ok    bool
	}{
		// keyword-anchored
		{input: "Your verification code is 654321", want: "654321", ok: true},
		{input: "Your verification code is valid for 10 minutes: 482913", want: "482913", ok: true},
		{input: "Your verification code will expire soon.\n\n482913", want: "482913", ok: true},
		{input: "Enter the security code below to continue\n\n771122", want: "771122", ok: true},
		{input: "Your code: 123-456", want: "123456", ok: true},
		{input: "Your code is 123 456", want: "123456", ok: true},
		{input: "Ihr Code lautet 123456", want: "123456", ok: true},
		{input: "Tu código de verificación es 998877", want: "998877", ok: true},
		{input: "OTP: 4821", want: "4821", ok: true},
		{input: "Your one-time passcode is 7K3PQ2", want: "7K3PQ2", ok: true},
		{input: "Sign-in code\n\n445566\n\nThis code expires in 5 minutes.", want: "445566", ok: true},
		{input: "Use this PIN code 2468 to unlock", want: "2468", ok: true},
		// conservative fallback without a keyword
		{input: "Use 112233 to finish signing in", want: "112233", ok: true},
		{input: "Welcome back, there is nothing to verify here."},
		{input: "© 2024 Netflix, Inc. 100 Winchester Circle, Los Gatos, CA 95032"},
		{input: "Order #123456 has shipped. Track it at 555 0100 ext 4433"},
		{input: "Two codes 111111 and 222222 are both in here"},
		// rejections around keywords
		{input: "Your code is valid until 2026. Thanks!"},
		{input: "Promo code SUMMER applies; nothing numeric"},
	}

	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got, ok := ExtractVerificationCode(tc.input)
			if ok != tc.ok {
				t.Fatalf("ExtractVerificationCode(%q) ok = %v (code %q), want ok = %v", tc.input, ok, got, tc.ok)
			}
			if got != tc.want {
				t.Errorf("ExtractVerificationCode(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

// A failed extraction must return the empty string as well as ok == false, so
// callers that ignore ok cannot store a stale code.
func TestExtractVerificationCode_EmptyCodeWhenNotFound(t *testing.T) {
	code, ok := ExtractVerificationCode("nothing to see here")
	if ok || code != "" {
		t.Errorf("ExtractVerificationCode = (%q, %v), want (\"\", false)", code, ok)
	}
}
