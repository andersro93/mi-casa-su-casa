package security

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"strings"
)

// ipDigestContext separates this use of AUTH_SECRET from every other one, so
// two digests built from the same secret for different purposes cannot be
// compared or swapped.
const ipDigestContext = "mi-casa/ip"

// ClientIP is the client's address, as far as it can be trusted
// (REF §A1, "Rate limiting").
//
// On Workers this was simply cf-connecting-ip, which Cloudflare set and a
// caller could not forge. There is no such header off Cloudflare, and
// X-Forwarded-For is caller-supplied: trusting it blindly would let anyone
// mint a fresh rate-limit bucket per request and walk straight through the
// brake.
//
// So the header is only consulted when the operator has declared how many
// proxies sit in front (TRUSTED_PROXY_HOPS), and the address is counted from
// the RIGHT — the last entry a trusted proxy actually observed. Anything a
// client prepends sits further left and is ignored. With 0 hops (the default)
// the header is not read at all.
//
// remoteAddr is net/http's r.RemoteAddr, which carries a port. The port is
// stripped: it changes per connection, and keeping it would put every single
// request in its own bucket, quietly disabling the limiter.
func ClientIP(forwardedFor, remoteAddr string, trustedHops int) string {
	socket := stripPort(remoteAddr)

	if trustedHops <= 0 {
		return orUnknown(socket)
	}

	chain := make([]string, 0, 4)
	for _, part := range strings.Split(forwardedFor, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			chain = append(chain, trimmed)
		}
	}
	if len(chain) == 0 {
		return orUnknown(socket)
	}

	// The rightmost entry was appended by the nearest proxy, so hop N back
	// from the end is the address the outermost trusted proxy saw. A hop
	// count larger than the chain floors at the leftmost entry rather than
	// indexing out of it.
	index := len(chain) - trustedHops
	if index < 0 {
		index = 0
	}
	return orUnknown(chain[index])
}

// IPDigest returns the function that turns a client address into the opaque
// value a rate-limit key is built from.
//
// The address is never stored raw: rate-limit rows outlive the request and a
// database dump would otherwise be a log of who visited which household. The
// secret is the process's AUTH_SECRET, so the digest is unforgeable from
// outside and unreadable without it.
func IPDigest(secret string) func(ip string) string {
	return func(ip string) string {
		sum := sha256.Sum256([]byte(secret + ipDigestContext + ip))
		return hex.EncodeToString(sum[:])
	}
}

// stripPort removes a trailing port from an address, leaving IPv6 literals
// unbracketed. An address without a port is returned unchanged.
func stripPort(address string) string {
	if address == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(address); err == nil {
		return host
	}
	return address
}

// orUnknown gives an address-less caller a stable bucket rather than an empty
// key, so a request that arrives without either source is still rate limited.
func orUnknown(address string) string {
	if address == "" {
		return "unknown"
	}
	return address
}
