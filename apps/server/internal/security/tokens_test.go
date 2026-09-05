package security

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"testing"
)

// The TypeScript original used crypto.randomUUID(), whose output the invite
// URL and the SPA both treat as opaque — but the shape is still part of the
// contract for anyone reading a link (src/server/security/tokens.ts).
var uuidV4Pattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestNewInvitationToken_ShapeAndHash(t *testing.T) {
	token, hash, err := NewInvitationToken()
	if err != nil {
		t.Fatalf("NewInvitationToken: %v", err)
	}
	if !uuidV4Pattern.MatchString(token) {
		t.Errorf("token = %q, want a lower-case random UUID v4", token)
	}
	if hash != HashInvitationToken(token) {
		t.Errorf("NewInvitationToken hash = %q, want HashInvitationToken(token) = %q", hash, HashInvitationToken(token))
	}
}

// The token is the only thing that authenticates an invite link, so two
// invitations must never collide.
func TestNewInvitationToken_IsRandom(t *testing.T) {
	seen := make(map[string]bool, 64)
	for i := 0; i < 64; i++ {
		token, _, err := NewInvitationToken()
		if err != nil {
			t.Fatalf("NewInvitationToken: %v", err)
		}
		if seen[token] {
			t.Fatalf("NewInvitationToken returned %q twice in 64 draws", token)
		}
		seen[token] = true
	}
}

// The stored value is a SHA-256 hex digest (REF §A3, "Invitations"): a leaked
// database must not hand out working invite links.
func TestHashInvitationToken(t *testing.T) {
	const token = "9f1b0f4c-6a3e-4f2b-9c2d-1a2b3c4d5e6f"
	sum := sha256.Sum256([]byte(token))
	want := hex.EncodeToString(sum[:])

	if got := HashInvitationToken(token); got != want {
		t.Errorf("HashInvitationToken(%q) = %q, want %q", token, got, want)
	}
	if got := HashInvitationToken(token); got != want {
		t.Errorf("HashInvitationToken is not deterministic: second call gave %q", got)
	}
	if HashInvitationToken(token) == HashInvitationToken(token+"x") {
		t.Error("HashInvitationToken collided on two different tokens")
	}
	if len(HashInvitationToken("")) != 64 {
		t.Errorf("HashInvitationToken(\"\") length = %d, want 64 hex characters", len(HashInvitationToken("")))
	}
}
