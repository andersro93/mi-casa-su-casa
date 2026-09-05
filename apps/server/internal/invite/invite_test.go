package invite_test

import (
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/invite"
)

// The rest of this package is exercised end to end through the admin routes
// (internal/api/admin_invitations_test.go). What is left is the one rule those
// tests cannot reach, because the test rig's APP_URL has no trailing slash.

func TestURLToleratesATrailingSlashOnTheAppURL(t *testing.T) {
	const token = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
	want := "https://casa.example/invite/" + token

	for _, appURL := range []string{"https://casa.example", "https://casa.example/"} {
		if got := invite.URL(appURL, token); got != want {
			t.Errorf("URL(%q) = %q, want %q", appURL, got, want)
		}
	}
}
