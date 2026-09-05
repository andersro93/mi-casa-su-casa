package security

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

// Ports Pjokk's internal/ratelimit ClientIP cases. X-Forwarded-For is
// caller-supplied, so it is only consulted when the operator has declared how
// many proxies sit in front (TRUSTED_PROXY_HOPS), and the address is counted
// from the RIGHT — anything a client prepends sits further left and is
// ignored (REF §A1, "Rate limiting").
func TestClientIP(t *testing.T) {
	cases := []struct {
		name       string
		forwarded  string
		remote     string
		hops       int
		want       string
		wantReason string
	}{
		{
			name:       "zero hops ignores the header entirely",
			forwarded:  "1.2.3.4",
			remote:     "10.0.0.1:5555",
			hops:       0,
			want:       "10.0.0.1",
			wantReason: "the default deployment has no proxy, so a forged header must not be read",
		},
		{
			name:      "negative hops ignores the header entirely",
			forwarded: "1.2.3.4",
			remote:    "10.0.0.1:5555",
			hops:      -1,
			want:      "10.0.0.1",
		},
		{
			name:       "one hop picks the rightmost entry",
			forwarded:  "9.9.9.9, 1.2.3.4",
			remote:     "10.0.0.1:5555",
			hops:       1,
			want:       "1.2.3.4",
			wantReason: "9.9.9.9 is client-supplied noise ahead of the single trusted proxy",
		},
		{
			name:      "two hops counts back from the right",
			forwarded: "9.9.9.9, 1.2.3.4, 172.16.0.1",
			remote:    "10.0.0.1:5555",
			hops:      2,
			want:      "1.2.3.4",
		},
		{
			name:       "more hops than the chain floors at the leftmost entry",
			forwarded:  "1.2.3.4, 172.16.0.1",
			remote:     "10.0.0.1:5555",
			hops:       5,
			want:       "1.2.3.4",
			wantReason: "a misconfigured hop count must not index out of the chain",
		},
		{
			name:      "whitespace and empty entries are ignored",
			forwarded: "  ,  1.2.3.4 ,   ",
			remote:    "10.0.0.1:5555",
			hops:      1,
			want:      "1.2.3.4",
		},
		{
			name:       "several header lines joined into one chain read as one chain",
			forwarded:  "9.9.9.9, 1.2.3.4,203.0.113.5",
			remote:     "10.0.0.1:5555",
			hops:       1,
			want:       "203.0.113.5",
			wantReason: "hop-counting inside only the first line lands in client-supplied data",
		},
		{
			name:      "an empty header falls back to the socket address",
			forwarded: "",
			remote:    "10.0.0.1:5555",
			hops:      1,
			want:      "10.0.0.1",
		},
		{
			name:      "no header and no socket address is unknown",
			forwarded: "",
			remote:    "",
			hops:      1,
			want:      "unknown",
		},
		{
			name:      "no header and no socket address is unknown at zero hops too",
			forwarded: "",
			remote:    "",
			hops:      0,
			want:      "unknown",
		},
		{
			name:       "a bare socket address without a port is used as-is",
			forwarded:  "",
			remote:     "10.0.0.1",
			hops:       0,
			want:       "10.0.0.1",
			wantReason: "net/http always sets a port, but callers may pass a normalised address",
		},
		{
			name:       "an IPv6 socket address loses only its port",
			forwarded:  "",
			remote:     "[2001:db8::1]:5555",
			hops:       0,
			want:       "2001:db8::1",
			wantReason: "one bucket per client, not one bucket per connection",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClientIP(tc.forwarded, tc.remote, tc.hops)
			if got != tc.want {
				t.Errorf("ClientIP(%q, %q, %d) = %q, want %q (%s)",
					tc.forwarded, tc.remote, tc.hops, got, tc.want, tc.wantReason)
			}
		})
	}
}

// The rate-limit key must never carry a raw address (REF §A1, "Rate
// limiting"): it is derived with a keyed SHA-256 so a database dump cannot be
// walked back to the households' visitors.
func TestIPDigest(t *testing.T) {
	digest := IPDigest("auth-secret")

	sum := sha256.Sum256([]byte("auth-secret" + "mi-casa/ip" + "10.0.0.1"))
	want := hex.EncodeToString(sum[:])
	if got := digest("10.0.0.1"); got != want {
		t.Errorf("IPDigest(secret)(%q) = %q, want %q", "10.0.0.1", got, want)
	}

	if digest("10.0.0.1") != digest("10.0.0.1") {
		t.Error("IPDigest is not deterministic, so a caller would get a fresh bucket per request")
	}
	if digest("10.0.0.1") == digest("10.0.0.2") {
		t.Error("IPDigest collided on two different addresses")
	}

	other := IPDigest("another-secret")
	if other("10.0.0.1") == digest("10.0.0.1") {
		t.Error("IPDigest ignored the secret, so the digest would be a plain unsalted hash")
	}
}
