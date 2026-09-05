package api_test

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/household-creation.test.ts and the "leave" half of
// test/integration/membership-removal.test.ts: the household routes against a
// real database and the whole handler chain.

const memberEmail = "member@example.com"

// signUp creates an account without an invitation and signs it in, which is
// what the TypeScript tests did with the provisioning auth instance. Setup and
// invitation-accept are the only routes that mint an account, and neither is
// what these tests are about.
func signUp(t *testing.T, app *testrig.AppRig, email, name string) (userID, cookie string) {
	t.Helper()

	userID, err := app.Deps.Auth.CreateUser(t.Context(), name, email, testrig.Password)
	if err != nil {
		t.Fatalf("signUp(%q): %v", email, err)
	}
	return userID, app.SignIn(t, email, testrig.Password)
}

// createHousehold posts one creation request.
func createHousehold(t *testing.T, app *testrig.AppRig, cookie, slug string) *http.Response {
	t.Helper()
	return app.Do(t, http.MethodPost, "/api/households",
		map[string]any{"slug": slug, "displayName": "Household " + slug},
		testrig.WithCookie(cookie)).Result()
}

func TestListMyHouseholds(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodGet, "/api/households/me", nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}

	households, ok := app.JSON(t, rec)["households"].([]any)
	if !ok || len(households) != 1 {
		t.Fatalf("households = %v, want one entry", app.JSON(t, rec)["households"])
	}
	entry, _ := households[0].(map[string]any)
	if entry["slug"] != slug || entry["role"] != "owner" || entry["displayName"] != testrig.OwnerHouseholdName {
		t.Errorf("entry = %v", entry)
	}
	if entry["id"] == "" || entry["id"] == nil {
		t.Error("entry carried no id")
	}
}

func TestHouseholdRoutesRequireASession(t *testing.T) {
	app := testrig.App(t)
	app.CompleteSetup(t)

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/households/me"},
		{http.MethodPost, "/api/households"},
		{http.MethodPost, "/api/households/" + testrig.OwnerHouseholdSlug + "/leave"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			var body any
			if tc.path == "/api/households" {
				body = map[string]any{"slug": "otra", "displayName": "Otra"}
			}
			rec := app.Do(t, tc.method, tc.path, body)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != "Unauthorized" {
				t.Errorf("error = %q", got)
			}
		})
	}
}

// The first case of household-creation.test.ts: the installation owner may
// create more households; a member of one may not.
func TestCreateHouseholdInstallationOwnerMayButMemberMayNot(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")

	created := app.Do(t, http.MethodPost, "/api/households",
		map[string]any{"slug": "cabin", "displayName": "Cabin"},
		testrig.WithCookie(ownerCookie))
	if created.Code != http.StatusCreated {
		t.Fatalf("owner create: %d %s", created.Code, created.Body.String())
	}
	household, _ := app.JSON(t, created)["household"].(map[string]any)
	if household["slug"] != "cabin" || household["role"] != "owner" || household["displayName"] != "Cabin" {
		t.Errorf("household = %v", household)
	}
	// The switcher entry's keys plus the timestamps, so the SPA can use the
	// body without a refetch.
	for _, key := range []string{"id", "createdAt", "updatedAt"} {
		if value, ok := household[key].(string); !ok || value == "" {
			t.Errorf("household[%q] = %v", key, household[key])
		}
	}

	refused := createHousehold(t, app, memberCookie, "mine")
	if refused.StatusCode != http.StatusForbidden {
		t.Fatalf("member create: %d", refused.StatusCode)
	}
	if got := app.Count(t, "households", "TRUE"); got != 2 {
		t.Errorf("households = %d, want 2", got)
	}
}

func TestCreateHouseholdRefusalMessage(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")

	rec := app.Do(t, http.MethodPost, "/api/households",
		map[string]any{"slug": "mine", "displayName": "Mine"},
		testrig.WithCookie(memberCookie))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	want := "Only the installation owner can create additional households. " +
		"Ask them to create it and invite you."
	if got := app.JSON(t, rec)["error"]; got != want {
		t.Errorf("error = %q", got)
	}
}

// The second case: somebody with no household at all may create their first,
// so a user whose only household was removed can recover — but only one.
func TestCreateHouseholdFirstOneIsAllowedSecondIsNot(t *testing.T) {
	app := testrig.App(t)
	_, cookie := signUp(t, app, "solo@example.com", "Solo")

	if first := createHousehold(t, app, cookie, "solo"); first.StatusCode != http.StatusCreated {
		t.Fatalf("first create: %d", first.StatusCode)
	}
	if second := createHousehold(t, app, cookie, "solo-two"); second.StatusCode != http.StatusForbidden {
		t.Fatalf("second create: %d", second.StatusCode)
	}
}

// The third case: REF §A3's slug rules apply at creation, and nothing is
// written when they fail.
func TestCreateHouseholdRejectsReservedOrMalformedSlugs(t *testing.T) {
	app := testrig.App(t)
	_, cookie := signUp(t, app, "solo@example.com", "Solo")

	for _, slug := range []string{"members", "settings", "api", "-bad", "x"} {
		t.Run(slug, func(t *testing.T) {
			rec := app.Do(t, http.MethodPost, "/api/households",
				map[string]any{"slug": slug, "displayName": "Nope"},
				testrig.WithCookie(cookie))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			// The message the SPA renders next to the input, filed under the
			// field it belongs to.
			fields, _ := app.JSON(t, rec)["fields"].(map[string]any)
			if message, _ := fields["slug"].(string); message == "" {
				t.Errorf("fields = %v, want a message for slug", fields)
			}
		})
	}

	if got := app.Count(t, "households", "TRUE"); got != 0 {
		t.Errorf("households = %d, want 0", got)
	}
}

func TestCreateHouseholdRejectsAnEmptyDisplayName(t *testing.T) {
	app := testrig.App(t)
	_, cookie := signUp(t, app, "solo@example.com", "Solo")

	rec := app.Do(t, http.MethodPost, "/api/households",
		map[string]any{"slug": "solo", "displayName": "   "},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	fields, _ := app.JSON(t, rec)["fields"].(map[string]any)
	if got := fields["displayName"]; got != "displayName is required" {
		t.Errorf("fields[displayName] = %v", got)
	}
}

func TestCreateHouseholdSlugAlreadyExists(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodPost, "/api/households",
		map[string]any{"slug": strings.ToUpper(slug), "displayName": "Casa Again"},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Household slug already exists" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "households", "TRUE"); got != 1 {
		t.Errorf("households = %d, want 1", got)
	}
}

func TestCreateHouseholdRecordsAnAudit(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	if rec := createHousehold(t, app, cookie, "cabin"); rec.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d", rec.StatusCode)
	}
	if got := app.Count(t, "audit_events",
		`"action" = 'household.created' AND "details"->>'slug' = 'cabin'`); got != 1 {
		t.Errorf("household.created audits = %d, want 1", got)
	}
}

func TestCreateHouseholdIsRateLimited(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	// 10 per hour. The installation owner is the only caller who can spend
	// the budget on successes, which is exactly why the limit exists.
	var last *http.Response
	for i := range 11 {
		last = createHousehold(t, app, cookie, "cabin-"+string(rune('a'+i)))
	}
	if last.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("eleventh create: %d", last.StatusCode)
	}
	if last.Header.Get("Retry-After") == "" {
		t.Error("a 429 carried no Retry-After header")
	}
}

// The leave cases of membership-removal.test.ts.
func TestLeaveHouseholdRefusesTheOnlyOwner(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	app.CreateMember(t, slug, memberEmail, "Member", "member")

	rec := app.Do(t, http.MethodPost, "/api/households/"+slug+"/leave", nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	want := "You are the only owner of this household. Make another member an owner first."
	if got := app.JSON(t, rec)["error"]; got != want {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "household_memberships", "TRUE"); got != 2 {
		t.Errorf("memberships = %d, want 2", got)
	}
}

func TestLeaveHouseholdMemberLeavesAndProviderAccessCascades(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)
	memberCookie := app.CreateMember(t, slug, memberEmail, "Member", "member")

	// A member with provider access: the grant hangs off the membership, so
	// leaving must take it with it.
	household, err := app.Deps.Repo.GetHouseholdBySlug(t.Context(), slug)
	if err != nil || household == nil {
		t.Fatalf("household %q: %v", slug, err)
	}
	provider, err := app.Deps.Repo.CreateProvider(t.Context(), household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	member, err := app.Deps.Repo.FindUserByEmail(t.Context(), memberEmail)
	if err != nil || member == nil {
		t.Fatalf("member: %v", err)
	}
	if err := app.Deps.Repo.GrantProviderAccess(t.Context(), household.ID, member.ID, provider.ID); err != nil {
		t.Fatalf("grant access: %v", err)
	}
	if got := app.Count(t, "household_member_provider_access", "TRUE"); got != 1 {
		t.Fatalf("provider access rows = %d, want 1", got)
	}

	logs := &bytes.Buffer{}
	applog.SetOutput(logs)
	t.Cleanup(func() { applog.SetOutput(nil) })

	rec := app.Do(t, http.MethodPost, "/api/households/"+slug+"/leave", nil, testrig.WithCookie(memberCookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["ok"]; got != true {
		t.Errorf("body = %s", rec.Body.String())
	}
	if got := app.Count(t, "household_memberships", "TRUE"); got != 1 {
		t.Errorf("memberships = %d, want 1", got)
	}
	if got := app.Count(t, "household_member_provider_access", "TRUE"); got != 0 {
		t.Errorf("provider access rows = %d, want 0", got)
	}
	if got := app.Count(t, "audit_events", `"action" = 'member.left'`); got != 1 {
		t.Errorf("member.left audits = %d, want 1", got)
	}
	if !strings.Contains(logs.String(), `"event":"member_left"`) {
		t.Errorf("logs = %s, want a member_left event", logs.String())
	}

	// The tenancy guard answers a former member exactly as it answers a
	// stranger: 403, never 404, so nobody can enumerate households.
	again := app.Do(t, http.MethodPost, "/api/households/"+slug+"/leave", nil, testrig.WithCookie(memberCookie))
	if again.Code != http.StatusForbidden {
		t.Fatalf("leaving twice: %d %s", again.Code, again.Body.String())
	}
}

func TestLeaveHouseholdOwnerMayLeaveOnceAnotherOwnerExists(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	app.CreateMember(t, slug, memberEmail, "Member", "owner")

	rec := app.Do(t, http.MethodPost, "/api/households/"+slug+"/leave", nil, testrig.WithCookie(ownerCookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.Count(t, "household_memberships", `"role" = 'owner'`); got != 1 {
		t.Errorf("owners = %d, want 1", got)
	}
}

func TestLeaveHouseholdUnknownSlugIsForbidden(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodPost, "/api/households/nowhere/leave", nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Forbidden" {
		t.Errorf("error = %q", got)
	}
}

// A slug that could never name a household is refused the same way any other
// non-membership is: the tenancy guard's 403, not a validation error that
// would distinguish "no such household" from "not yours".
func TestLeaveHouseholdImplausibleSlugIsForbidden(t *testing.T) {
	app := testrig.App(t)
	cookie, _ := app.CompleteSetup(t)

	for _, slug := range []string{"x", strings.Repeat("s", 60)} {
		rec := app.Do(t, http.MethodPost, "/api/households/"+slug+"/leave", nil, testrig.WithCookie(cookie))
		if rec.Code != http.StatusForbidden {
			t.Errorf("%q: status = %d %s", slug, rec.Code, rec.Body.String())
		}
	}
}
