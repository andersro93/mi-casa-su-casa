// Package security holds the small primitives the rest of the server leans
// on to keep secrets, invitation tokens and client addresses honest. Every
// function here is pure and cheap; the policy that uses them (rate limits,
// invitation lifetimes, auth guards) lives with the routes.
package security

import (
	"crypto/sha256"
	"crypto/subtle"
)

// Ports src/server/security/compare.ts.

// SecretsEqual reports whether two secrets are the same, in constant time.
//
// Both values are hashed first so the comparison always runs over equal-length
// buffers: neither the length of the expected secret nor the position of the
// first differing byte can be read off the time the check takes. Comparing
// the raw strings would leak both, and the setup secret is guessable enough
// without that help.
func SecretsEqual(a, b string) bool {
	da := sha256.Sum256([]byte(a))
	db := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(da[:], db[:]) == 1
}
