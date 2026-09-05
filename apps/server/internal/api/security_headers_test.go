package api_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/security"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// The cross-cutting properties of the assembled chain (REF §A1): the headers
// every API response carries, the same-site guard in front of every mutation,
// and the JSON 404 for a path the spec does not describe. They are tested
// through the whole handler rather than against the middlewares directly —
// those have their own unit tests, and what is at stake here is the WIRING.

func TestAPIResponsesCarryNoSniff(t *testing.T) {
	app := testrig.App(t)

	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"a success", http.MethodGet, "/api/setup/status", nil},
		{"a validation failure", http.MethodPost, "/api/setup/complete", map[string]any{"email": "x"}},
		{"a 404", http.MethodGet, "/api/nope", nil},
		{"a probe", http.MethodGet, "/healthz", nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.Do(t, tc.method, tc.path, tc.body)
			if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q, want nosniff (status %d)", got, rec.Code)
			}
			if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
				t.Errorf("Content-Type = %q, want JSON", got)
			}
		})
	}
}

func TestNoCORSHeaderForAForeignOrigin(t *testing.T) {
	app := testrig.App(t)

	req := httptest.NewRequest(http.MethodGet, "/api/setup/status", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := app.DoRequest(req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Access-Control-Allow-Origin = %q, want none (REF §A1: no CORS middleware)", got)
	}
}

func TestCrossSiteMutationsAreRejected(t *testing.T) {
	app := testrig.App(t)

	cases := []struct {
		name    string
		headers map[string]string
		reject  bool
	}{
		{"foreign Origin", map[string]string{"Origin": "https://evil.example"}, true},
		{"cross-site fetch with no Origin", map[string]string{"Sec-Fetch-Site": "cross-site"}, true},
		{"foreign Referer with no Origin", map[string]string{"Referer": "https://evil.example/page"}, true},
		{"our own Origin", map[string]string{"Origin": testrig.AppURL}, false},
		{"no headers at all", nil, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/setup/complete", strings.NewReader("{}"))
			req.Header.Set("Content-Type", "application/json")
			for name, value := range tc.headers {
				req.Header.Set(name, value)
			}
			rec := app.DoRequest(req)

			if tc.reject {
				if rec.Code != http.StatusForbidden {
					t.Fatalf("status = %d %s, want 403", rec.Code, rec.Body.String())
				}
				if got := app.JSON(t, rec)["error"]; got != "Cross-site request rejected" {
					t.Errorf("error = %q", got)
				}
				return
			}
			// Not rejected by the same-site guard: it got as far as the body
			// validation below it, which is what a 400 here proves.
			if rec.Code == http.StatusForbidden {
				t.Fatalf("same-site request was rejected: %s", rec.Body.String())
			}
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d %s, want the 400 from validation", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestUnknownAPIPathIsAJSON404(t *testing.T) {
	app := testrig.App(t)

	rec := app.Do(t, http.MethodGet, "/api/nope", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Not found" {
		t.Errorf("error = %q", got)
	}
}

func TestWrongMethodOnAKnownPath(t *testing.T) {
	app := testrig.App(t)

	rec := app.Do(t, http.MethodDelete, "/api/setup/status", nil)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Method not allowed" {
		t.Errorf("error = %q", got)
	}
}

// TestAuthRoutesBypassSpecValidation pins the one exclusion: Limen's routes
// are not in the spec, and without the skipper the "a path the spec does not
// describe does not exist" 404 would swallow every sign-in.
func TestAuthRoutesBypassSpecValidation(t *testing.T) {
	app := testrig.App(t)
	app.CompleteSetup(t)

	rec := app.Do(t, http.MethodPost, "/api/auth/signin/credential", map[string]any{
		"credential": testrig.OwnerEmail,
		"password":   testrig.Password,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign in through the assembled handler: %d %s", rec.Code, rec.Body.String())
	}
}

// --- shared test helpers -------------------------------------------------

// newJSONRequest builds a request with a raw body, for the cases Do's
// json.Marshal cannot express (a body that is not valid JSON).
func newJSONRequest(t *testing.T, method, path, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", testrig.AppURL)
	return req
}

// newInvitationToken mints a token and its stored hash.
func newInvitationToken(t *testing.T) (token, hash string) {
	t.Helper()
	token, hash, err := security.NewInvitationToken()
	if err != nil {
		t.Fatalf("mint invitation token: %v", err)
	}
	return token, hash
}

// invitationInput spells out one invitation, for the test that needs a
// provider scope the rig's own Invite helper does not take.
func invitationInput(householdID, email, name, role, hash, invitedBy string, expiresAt time.Time, providerIDs []string) repo.CreateInvitationInput {
	return repo.CreateInvitationInput{
		HouseholdID:     householdID,
		Email:           email,
		Name:            name,
		Role:            role,
		TokenHash:       hash,
		InvitedByUserID: invitedBy,
		ExpiresAt:       expiresAt,
		ProviderIDs:     providerIDs,
	}
}
