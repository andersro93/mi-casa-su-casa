package security

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// Ports src/server/security/tokens.ts (REF §A3, "Invitations").

// NewInvitationToken mints an invitation token and the hash to store beside
// it. The token goes into the invite URL and is never persisted; only the
// hash is, so a leaked database hands out no working links.
//
// The token is a random UUID formatted the way the Workers runtime's
// crypto.randomUUID() did — links minted by the old deployment and by this
// one are indistinguishable, and links already in someone's inbox keep
// working.
func NewInvitationToken() (token, hash string, err error) {
	token, err = randomUUID()
	if err != nil {
		return "", "", err
	}
	return token, HashInvitationToken(token), nil
}

// HashInvitationToken is the one-way transform between the token in a link
// and the `token_hash` column it is looked up by.
//
// A plain SHA-256 is deliberate: the token is 122 bits of CSPRNG output, not
// a password, so there is nothing to brute-force and nothing a slow KDF would
// buy — while a lookup by hash has to stay a single indexed query.
func HashInvitationToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// randomUUID returns a random (version 4) UUID in the canonical lower-case
// 8-4-4-4-12 form.
func randomUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("security: read random bytes: %w", err)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx (RFC 4122)

	return fmt.Sprintf("%x-%x-%x-%x-%x",
		bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
