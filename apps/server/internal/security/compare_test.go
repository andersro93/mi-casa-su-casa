package security

import "testing"

// Ports test/secrets-compare.test.ts.
func TestSecretsEqual(t *testing.T) {
	cases := []struct {
		name       string
		a          string
		b          string
		want       bool
		wantReason string
	}{
		{
			name: "identical secrets",
			a:    "correct horse",
			b:    "correct horse",
			want: true,
		},
		{
			name:       "one character apart",
			a:          "correct horse",
			b:          "correct horsf",
			want:       false,
			wantReason: "the digests differ everywhere, so the comparison cannot leak where",
		},
		{
			name:       "different lengths",
			a:          "short",
			b:          "a much longer secret",
			want:       false,
			wantReason: "hashing first makes both operands 32 bytes, so length never leaks",
		},
		{
			name: "both empty",
			a:    "",
			b:    "",
			want: true,
		},
		{
			name:       "empty against a secret",
			a:          "",
			b:          "correct horse",
			want:       false,
			wantReason: "an unset secret must never authenticate anything",
		},
		{
			name:       "case differs",
			a:          "Correct Horse",
			b:          "correct horse",
			want:       false,
			wantReason: "secrets are compared byte for byte, not case-insensitively",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := SecretsEqual(tc.a, tc.b); got != tc.want {
				t.Errorf("SecretsEqual(%q, %q) = %v, want %v (%s)", tc.a, tc.b, got, tc.want, tc.wantReason)
			}
		})
	}
}
