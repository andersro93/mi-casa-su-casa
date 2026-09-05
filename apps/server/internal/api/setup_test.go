package api_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/setup-route.test.ts and setup-recovery.test.ts: the
// whole first-run flow against a real database and the real handler chain, so
// a passing test also proves the route is mounted, spec-validated, rate
// limited and able to write a session cookie.

// setupBody is the payload every case below starts from; each mutates a copy.
func setupBody(overrides map[string]any) map[string]any {
	body := map[string]any{
		"email":         testrig.OwnerEmail,
		"name":          "Owner",
		"password":      testrig.Password,
		"householdName": testrig.OwnerHouseholdName,
		"householdSlug": testrig.OwnerHouseholdSlug,
		"setupSecret":   testrig.SetupSecret,
	}
	for key, value := range overrides {
		body[key] = value
	}
	return body
}

func postSetup(t *testing.T, app *testrig.AppRig, body map[string]any) *http.Response {
	t.Helper()
	return app.Do(t, http.MethodPost, "/api/setup/complete", body).Result()
}

func TestSetupStatusBeforeAndAfter(t *testing.T) {
	app := testrig.App(t)

	before := app.Do(t, http.MethodGet, "/api/setup/status", nil)
	if before.Code != http.StatusOK {
		t.Fatalf("status before: %d %s", before.Code, before.Body.String())
	}
	body := app.JSON(t, before)
	if body["needsSetup"] != true || body["status"] != "pending" || body["setupLocked"] != false {
		t.Errorf("status before setup = %v", body)
	}
	if body["isConfigured"] != true {
		t.Errorf("isConfigured = %v, want true", body["isConfigured"])
	}
	if body["emailDomain"] != testrig.EmailDomain {
		t.Errorf("emailDomain = %v, want %q", body["emailDomain"], testrig.EmailDomain)
	}
	// The endpoint is public: it must never name the owner.
	if _, leaked := body["ownerEmail"]; leaked {
		t.Errorf("setup status leaked ownerEmail: %v", body)
	}

	app.CompleteSetup(t)

	after := app.Do(t, http.MethodGet, "/api/setup/status", nil)
	locked := app.JSON(t, after)
	if locked["needsSetup"] != false || locked["setupLocked"] != true || locked["status"] != "complete" {
		t.Errorf("status after setup = %v", locked)
	}
	if _, leaked := locked["ownerEmail"]; leaked {
		t.Errorf("locked setup status leaked ownerEmail: %v", locked)
	}
}

func TestSetupCreatesOwnerHouseholdAndSession(t *testing.T) {
	app := testrig.App(t)

	rec := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	if rec.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rec.Code, rec.Body.String())
	}

	body := app.JSON(t, rec)
	member, _ := body["member"].(map[string]any)
	if member["email"] != testrig.OwnerEmail || member["role"] != "owner" {
		t.Errorf("member = %v", member)
	}
	if member["name"] != "Owner" {
		t.Errorf("member name = %v, want Owner", member["name"])
	}
	household, _ := body["household"].(map[string]any)
	if household["slug"] != testrig.OwnerHouseholdSlug {
		t.Errorf("household = %v", household)
	}

	// REF §A2: the response carries the session cookie, so the SPA lands
	// signed in rather than on a sign-in form.
	var signedIn bool
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == "mi_casa_session" && cookie.Value != "" {
			signedIn = true
		}
	}
	if !signedIn {
		t.Errorf("no session cookie on 201: %v", rec.Result().Cookies())
	}

	if got := app.Count(t, "users", "TRUE"); got != 1 {
		t.Errorf("users = %d, want 1", got)
	}
	if got := app.Count(t, "households", `"slug" = $1`, testrig.OwnerHouseholdSlug); got != 1 {
		t.Errorf("households with the slug = %d, want 1", got)
	}
	if got := app.Count(t, "household_memberships", `"role" = 'owner'`); got != 1 {
		t.Errorf("owner memberships = %d, want 1", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'installation.setup_completed'`); got != 1 {
		t.Errorf("audit rows = %d, want 1", got)
	}
	if app.InstallationStatus(t) != "complete" {
		t.Errorf("installation status = %q, want complete", app.InstallationStatus(t))
	}
}

func TestSetupIsLockedOnceComplete(t *testing.T) {
	app := testrig.App(t)
	app.CompleteSetup(t)

	again := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	if again.Code != http.StatusConflict {
		t.Fatalf("second setup: %d %s", again.Code, again.Body.String())
	}
	if got := app.JSON(t, again)["error"]; got != "Setup has already been completed" {
		t.Errorf("error = %q", got)
	}
}

func TestSetupIsNoSecretOracleOnceComplete(t *testing.T) {
	app := testrig.App(t)
	app.CompleteSetup(t)

	right := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	wrong := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(map[string]any{"setupSecret": "nope"}))

	if right.Code != http.StatusConflict || wrong.Code != http.StatusConflict {
		t.Fatalf("statuses = %d and %d, want both 409", right.Code, wrong.Code)
	}
	if right.Body.String() != wrong.Body.String() {
		t.Errorf("a completed installation answered differently to a right and a wrong secret:\n%s\n%s",
			right.Body.String(), wrong.Body.String())
	}
}

func TestSetupRejectsWrongSecretOrEmail(t *testing.T) {
	cases := []struct {
		name     string
		override map[string]any
		want     string
	}{
		{"wrong secret", map[string]any{"setupSecret": "nope"}, "Invalid setup secret"},
		{"other email", map[string]any{"email": "someone-else@example.com"}, "Setup email must match OWNER_EMAIL"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := testrig.App(t)

			rec := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(tc.override))
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != tc.want {
				t.Errorf("error = %q, want %q", got, tc.want)
			}
			// Nothing was created, and — just as important — the claim was
			// never taken, so a corrected retry is not blocked.
			if got := app.Count(t, "users", "TRUE"); got != 0 {
				t.Errorf("users = %d, want 0", got)
			}
			if got := app.Count(t, "households", "TRUE"); got != 0 {
				t.Errorf("households = %d, want 0", got)
			}
			if status := app.InstallationStatus(t); status != "pending" {
				t.Errorf("installation status = %q, want pending", status)
			}
		})
	}
}

func TestSetupEmailMatchIsCaseInsensitive(t *testing.T) {
	app := testrig.App(t)

	rec := app.Do(t, http.MethodPost, "/api/setup/complete",
		setupBody(map[string]any{"email": "  Owner@Example.COM  "}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["member"].(map[string]any)["email"]; got != testrig.OwnerEmail {
		t.Errorf("stored email = %v, want the normalised %q", got, testrig.OwnerEmail)
	}
}

func TestSetupValidatesTheBody(t *testing.T) {
	cases := []struct {
		name     string
		override map[string]any
		field    string
		message  string
	}{
		{"short password", map[string]any{"password": "short"}, "password", "password must be at least 12 characters"},
		{"reserved slug", map[string]any{"householdSlug": "admin"}, "householdSlug", `"admin" is reserved and cannot be used as a household slug`},
		{"slug too short", map[string]any{"householdSlug": "a"}, "householdSlug", "slug must be between 2 and 40 characters"},
		{"slug characters", map[string]any{"householdSlug": "Not Valid"}, "householdSlug",
			"slug may only contain lowercase letters, numbers, and hyphens, and must start and end with a letter or number"},
		{"blank name", map[string]any{"name": "   "}, "name", "name is required"},
		{"not an email", map[string]any{"email": "owner-at-example"}, "email", "email must be a valid email address"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := testrig.App(t)

			rec := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(tc.override))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			body := app.JSON(t, rec)
			fields, _ := body["fields"].(map[string]any)
			if fields[tc.field] != tc.message {
				t.Errorf("fields[%q] = %v, want %q (body %v)", tc.field, fields[tc.field], tc.message, body)
			}
			if status := app.InstallationStatus(t); status != "pending" {
				t.Errorf("installation status = %q, want pending", status)
			}
		})
	}
}

func TestSetupRejectsMalformedJSON(t *testing.T) {
	app := testrig.App(t)

	req := newJSONRequest(t, http.MethodPost, "/api/setup/complete", "{not json")
	rec := app.DoRequest(req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Invalid JSON body" {
		t.Errorf("error = %q, want %q", got, "Invalid JSON body")
	}
}

// --- recovery (test/integration/setup-recovery.test.ts) ------------------

func TestSetupRemovesAnOrphanOwnerFromAFailedAttempt(t *testing.T) {
	app := testrig.App(t)

	// Simulates: sign-up succeeded, household creation failed, the process
	// died. An account exists for OWNER_EMAIL with no household at all.
	if _, err := app.Deps.Auth.CreateUser(t.Context(), "Owner", testrig.OwnerEmail, testrig.Password); err != nil {
		t.Fatalf("seed orphan owner: %v", err)
	}
	if got := app.Count(t, "users", "TRUE"); got != 1 {
		t.Fatalf("users = %d, want 1", got)
	}

	rec := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.Count(t, "users", "TRUE"); got != 1 {
		t.Errorf("users = %d, want 1 (the orphan should have been replaced, not joined)", got)
	}
	if got := app.Count(t, "household_memberships", `"role" = 'owner'`); got != 1 {
		t.Errorf("owner memberships = %d, want 1", got)
	}
	if status := app.InstallationStatus(t); status != "complete" {
		t.Errorf("installation status = %q, want complete", status)
	}
}

func TestSetupFinishesAnInstallationWhoseOwnerAlreadyHasAHousehold(t *testing.T) {
	app := testrig.App(t)

	ownerID, err := app.Deps.Auth.CreateUser(t.Context(), "Owner", testrig.OwnerEmail, testrig.Password)
	if err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	if _, err := app.Deps.Repo.CreateHousehold(t.Context(),
		testrig.OwnerHouseholdSlug, testrig.OwnerHouseholdName, ownerID); err != nil {
		t.Fatalf("seed household: %v", err)
	}

	rec := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	want := "Setup has already been completed for this owner. Sign in with your owner account."
	if got := app.JSON(t, rec)["error"]; got != want {
		t.Errorf("error = %q, want %q", got, want)
	}

	installation, err := app.Rig.Q.GetInstallation(t.Context())
	if err != nil {
		t.Fatalf("read installation: %v", err)
	}
	if installation.Status != "complete" {
		t.Errorf("installation status = %q, want complete", installation.Status)
	}
	if installation.OwnerUserID == nil || *installation.OwnerUserID != ownerID {
		t.Errorf("installation owner = %v, want %q", installation.OwnerUserID, ownerID)
	}
}

func TestSetupReclaimsAStaleClaimButRespectsAFreshOne(t *testing.T) {
	app := testrig.App(t)
	now := time.Now()
	app.SetNow(now)

	// A concurrent attempt claimed the installation and has not finished.
	claimed, err := app.Rig.Q.BeginInstallationSetup(t.Context(), pgTimestamp(now.Add(-time.Hour)))
	if err != nil || claimed != 1 {
		t.Fatalf("seed claim: rows=%d err=%v", claimed, err)
	}

	blocked := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	if blocked.Code != http.StatusConflict {
		t.Fatalf("fresh claim: %d %s", blocked.Code, blocked.Body.String())
	}
	if got := app.JSON(t, blocked)["error"]; got != "Setup is already in progress or has been completed" {
		t.Errorf("error = %q", got)
	}

	// Past the recovery window the claim is abandoned and may be taken over.
	app.Advance(30 * time.Minute)
	recovered := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	if recovered.Code != http.StatusCreated {
		t.Fatalf("stale claim: %d %s", recovered.Code, recovered.Body.String())
	}
}

func TestSetupRollsBackTheOwnerWhenHouseholdCreationFails(t *testing.T) {
	app := testrig.App(t)

	// A household already holds the requested slug, so CreateHousehold fails
	// with a unique violation after the account has been created.
	seedOwner, err := app.Deps.Auth.CreateUser(t.Context(), "Someone", "someone@example.com", testrig.Password)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := app.Deps.Repo.CreateHousehold(t.Context(),
		testrig.OwnerHouseholdSlug, testrig.OwnerHouseholdName, seedOwner); err != nil {
		t.Fatalf("seed household: %v", err)
	}

	rec := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(nil))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "A household with that slug already exists" {
		t.Errorf("error = %q", got)
	}
	// The account this attempt created is gone (only the seeded one remains)
	// and the claim was released, so a corrected retry works.
	if got := app.Count(t, "users", `"email" = $1`, testrig.OwnerEmail); got != 0 {
		t.Errorf("owner accounts = %d, want 0 after the rollback", got)
	}
	if status := app.InstallationStatus(t); status != "pending" {
		t.Errorf("installation status = %q, want pending", status)
	}

	retry := app.Do(t, http.MethodPost, "/api/setup/complete", setupBody(map[string]any{"householdSlug": "otra"}))
	if retry.Code != http.StatusCreated {
		t.Fatalf("corrected retry: %d %s", retry.Code, retry.Body.String())
	}
}

func TestSetupIsRateLimited(t *testing.T) {
	app := testrig.App(t)

	// The rule is 5 per 15 minutes; every attempt below is refused for the
	// wrong secret, so none of them completes setup and all are charged.
	var last *http.Response
	for range 6 {
		last = postSetup(t, app, setupBody(map[string]any{"setupSecret": "nope"}))
	}
	if last.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("sixth attempt: %d", last.StatusCode)
	}
	if last.Header.Get("Retry-After") == "" {
		t.Error("a 429 carried no Retry-After header")
	}
}
