package api_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/settings-route.test.ts, the profile half of
// test/integration/two-factor.test.ts, and the session-revocation cases of
// test/integration/auth.test.ts and audit-log.test.ts.

// settings reads GET /api/settings, failing the test when it does not answer.
func settings(t *testing.T, app *testrig.AppRig, cookie string) map[string]any {
	t.Helper()

	rec := app.Do(t, http.MethodGet, "/api/settings", nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/settings: %d %s", rec.Code, rec.Body.String())
	}
	return app.JSON(t, rec)
}

// sessionsOf is the session list from GET /api/settings.
func sessionsOf(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()

	raw, ok := body["sessions"].([]any)
	if !ok {
		t.Fatalf("sessions = %v", body["sessions"])
	}
	sessions := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		session, ok := entry.(map[string]any)
		if !ok {
			t.Fatalf("session entry = %v", entry)
		}
		sessions = append(sessions, session)
	}
	return sessions
}

func TestSettingsRequireASession(t *testing.T) {
	app := testrig.App(t)
	app.CompleteSetup(t)

	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/api/settings", nil},
		{http.MethodGet, "/api/settings/households", nil},
		{http.MethodPatch, "/api/settings/profile", map[string]any{"name": "Nobody"}},
		{http.MethodDelete, "/api/settings/sessions/others", nil},
		{http.MethodDelete, "/api/settings/sessions/whatever", nil},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := app.Do(t, tc.method, tc.path, tc.body)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != "Unauthorized" {
				t.Errorf("error = %q", got)
			}
		})
	}
}

// settings-route.test.ts: the device list flags the current session and never
// carries a token.
func TestSettingsListsSessionsWithoutTokensAndFlagsTheCurrentOne(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	body := settings(t, app, cookie)
	sessions := sessionsOf(t, body)
	if len(sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(sessions))
	}
	if sessions[0]["isCurrent"] != true {
		t.Errorf("isCurrent = %v", sessions[0]["isCurrent"])
	}
	for _, key := range []string{"id", "expiresAt", "createdAt"} {
		if value, ok := sessions[0][key].(string); !ok || value == "" {
			t.Errorf("session[%q] = %v", key, sessions[0][key])
		}
	}
	// REF §A2: impersonation has no Go counterpart, and the ip digest is
	// opaque rather than an address.
	if _, present := sessions[0]["impersonatedBy"]; !present || sessions[0]["impersonatedBy"] != nil {
		t.Errorf("impersonatedBy = %v, want null", sessions[0]["impersonatedBy"])
	}
	for _, key := range []string{"ipAddress", "userAgent", "updatedAt"} {
		if _, present := sessions[0][key]; !present {
			t.Errorf("session is missing %q", key)
		}
	}

	// A session token is a bearer secret: it never leaves the server.
	if strings.Contains(strings.ToLower(rawBody(t, app, cookie)), "token") {
		t.Errorf("settings body mentions a token: %s", rawBody(t, app, cookie))
	}
}

// rawBody is GET /api/settings as it went on the wire, for the "no token
// anywhere in this payload" assertion.
func rawBody(t *testing.T, app *testrig.AppRig, cookie string) string {
	t.Helper()
	return app.Do(t, http.MethodGet, "/api/settings", nil, testrig.WithCookie(cookie)).Body.String()
}

func TestSettingsProfile(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	profile, ok := settings(t, app, cookie)["profile"].(map[string]any)
	if !ok {
		t.Fatalf("profile missing")
	}
	if profile["email"] != testrig.OwnerEmail || profile["name"] != "Owner" {
		t.Errorf("profile = %v", profile)
	}
	if profile["image"] != nil {
		t.Errorf("image = %v, want null", profile["image"])
	}
	// REF §A2: `role` carried Better Auth's global role and is always null
	// here, but stays in the payload because the SPA reads it.
	if value, present := profile["role"]; !present || value != nil {
		t.Errorf("role = %v, want null", value)
	}
	if profile["twoFactorEnabled"] != false {
		t.Errorf("twoFactorEnabled = %v, want false", profile["twoFactorEnabled"])
	}

	households, _ := profile["households"].([]any)
	if len(households) != 1 {
		t.Fatalf("households = %v", profile["households"])
	}
	entry, _ := households[0].(map[string]any)
	if entry["slug"] != slug || entry["role"] != "owner" {
		t.Errorf("household entry = %v", entry)
	}
}

// two-factor.test.ts's half of the profile: the flag Limen's two-factor plugin
// maintains is what the settings screen reads.
func TestSettingsProfileReportsTwoFactorEnabled(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	if _, err := app.Rig.Pool.Exec(t.Context(),
		`UPDATE "users" SET "two_factor_enabled" = true WHERE "email" = $1`, testrig.OwnerEmail,
	); err != nil {
		t.Fatalf("enable two-factor: %v", err)
	}

	profile, _ := settings(t, app, cookie)["profile"].(map[string]any)
	if profile["twoFactorEnabled"] != true {
		t.Errorf("twoFactorEnabled = %v, want true", profile["twoFactorEnabled"])
	}
}

func TestSettingsHouseholds(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodGet, "/api/settings/households", nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	households, _ := app.JSON(t, rec)["households"].([]any)
	if len(households) != 1 {
		t.Fatalf("households = %v", app.JSON(t, rec)["households"])
	}
	entry, _ := households[0].(map[string]any)
	if entry["slug"] != slug || entry["role"] != "owner" {
		t.Errorf("entry = %v", entry)
	}
}

func TestUpdateProfile(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodPatch, "/api/settings/profile",
		map[string]any{"name": "  Renamed  ", "image": "https://example.com/avatar.png"},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	profile, _ := app.JSON(t, rec)["profile"].(map[string]any)
	if profile["name"] != "Renamed" {
		t.Errorf("name = %v, want the trimmed value", profile["name"])
	}
	if profile["image"] != "https://example.com/avatar.png" {
		t.Errorf("image = %v", profile["image"])
	}

	// The empty string is how the SPA clears an avatar (REF §A4).
	cleared := app.Do(t, http.MethodPatch, "/api/settings/profile",
		map[string]any{"name": "Renamed", "image": ""}, testrig.WithCookie(cookie))
	if cleared.Code != http.StatusOK {
		t.Fatalf("clear: %d %s", cleared.Code, cleared.Body.String())
	}
	profile, _ = app.JSON(t, cleared)["profile"].(map[string]any)
	if profile["image"] != nil {
		t.Errorf("image = %v, want null", profile["image"])
	}

	// Omitting the key entirely does the same, which is what the TypeScript's
	// optional-then-transform schema did.
	omitted := app.Do(t, http.MethodPatch, "/api/settings/profile",
		map[string]any{"name": "Renamed"}, testrig.WithCookie(cookie))
	if omitted.Code != http.StatusOK {
		t.Fatalf("omitted image: %d %s", omitted.Code, omitted.Body.String())
	}
}

func TestUpdateProfileRejectsBadInput(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	for _, tc := range []struct {
		name  string
		body  map[string]any
		field string
		want  string
	}{
		{"blank name", map[string]any{"name": "   "}, "name", "name is required"},
		{
			"long name",
			map[string]any{"name": strings.Repeat("x", 81)},
			"name", "name must be at most 80 characters",
		},
		{
			"non-http image",
			map[string]any{"name": "Owner", "image": "ftp://example.com/a.png"},
			"image", "image must be an http(s) URL",
		},
		{
			"unparseable image",
			map[string]any{"name": "Owner", "image": "not a url"},
			"image", "image must be an http(s) URL",
		},
		{
			"long image",
			map[string]any{"name": "Owner", "image": "https://example.com/" + strings.Repeat("a", 2048)},
			"image", "image must be at most 2048 characters",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.Do(t, http.MethodPatch, "/api/settings/profile", tc.body, testrig.WithCookie(cookie))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			fields, _ := app.JSON(t, rec)["fields"].(map[string]any)
			if got := fields[tc.field]; got != tc.want {
				t.Errorf("fields[%q] = %v, want %q", tc.field, got, tc.want)
			}
		})
	}
}

// auth.test.ts's revocation case: signing out everywhere else really does stop
// the other cookie working.
func TestRevokeOtherSessions(t *testing.T) {
	app := testrig.App(t)
	first, _ := app.CompleteSetup(t)
	second := app.SignIn(t, testrig.OwnerEmail, testrig.Password)

	if got := len(sessionsOf(t, settings(t, app, second))); got != 2 {
		t.Fatalf("sessions = %d, want 2", got)
	}

	rec := app.Do(t, http.MethodDelete, "/api/settings/sessions/others", nil, testrig.WithCookie(second))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["ok"]; got != true {
		t.Errorf("body = %s", rec.Body.String())
	}

	// The revoked cookie is a cookie for a session that no longer exists.
	stale := app.Do(t, http.MethodGet, "/api/settings", nil, testrig.WithCookie(first))
	if stale.Code != http.StatusUnauthorized {
		t.Fatalf("the revoked cookie still works: %d %s", stale.Code, stale.Body.String())
	}
	if got := len(sessionsOf(t, settings(t, app, second))); got != 1 {
		t.Errorf("sessions after revoking = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'session.revoked_others'`); got != 1 {
		t.Errorf("session.revoked_others audits = %d, want 1", got)
	}
}

func TestRevokeOneSession(t *testing.T) {
	app := testrig.App(t)
	first, _ := app.CompleteSetup(t)
	second := app.SignIn(t, testrig.OwnerEmail, testrig.Password)

	// The one that is not the caller's own is the session the first cookie
	// belongs to — the id is all the screen ever has to address a device by.
	var target string
	for _, session := range sessionsOf(t, settings(t, app, second)) {
		if session["isCurrent"] != true {
			target, _ = session["id"].(string)
		}
	}
	if target == "" {
		t.Fatal("no other session to revoke")
	}

	rec := app.Do(t, http.MethodDelete, "/api/settings/sessions/"+target, nil, testrig.WithCookie(second))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}

	stale := app.Do(t, http.MethodGet, "/api/settings", nil, testrig.WithCookie(first))
	if stale.Code != http.StatusUnauthorized {
		t.Fatalf("the revoked cookie still works: %d %s", stale.Code, stale.Body.String())
	}
	if got := len(sessionsOf(t, settings(t, app, second))); got != 1 {
		t.Errorf("sessions after revoking = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events",
		`"action" = 'session.revoked' AND "target_id" = $1`, target); got != 1 {
		t.Errorf("session.revoked audits = %d, want 1", got)
	}
}

// A session id that is not the caller's own revokes nothing and still answers
// 200: a different status would say whether the id exists.
func TestRevokeSessionOfSomebodyElseIsANoOp(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")

	var memberSession string
	for _, session := range sessionsOf(t, settings(t, app, memberCookie)) {
		memberSession, _ = session["id"].(string)
	}
	if memberSession == "" {
		t.Fatal("the member has no session")
	}

	rec := app.Do(t, http.MethodDelete, "/api/settings/sessions/"+memberSession, nil,
		testrig.WithCookie(ownerCookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if survived := app.Do(t, http.MethodGet, "/api/settings", nil,
		testrig.WithCookie(memberCookie)); survived.Code != http.StatusOK {
		t.Errorf("the member's session was revoked by somebody else: %d", survived.Code)
	}
}
