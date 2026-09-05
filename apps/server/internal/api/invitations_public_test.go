package api_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/invitation-accept.test.ts (and the delivery half of
// invitation-service.test.ts that these two routes touch): the public
// invitation surface against a real database and the real handler chain.

const inviteeEmail = "kid@example.com"

// seedInvitation completes setup and writes one pending invitation for
// inviteeEmail, returning the token and the household slug.
func seedInvitation(t *testing.T, app *testrig.AppRig) (token, slug string) {
	t.Helper()
	_, slug = app.CompleteSetup(t)
	return app.Invite(t, slug, inviteeEmail, "Kid", "member", nil), slug
}

func lookup(t *testing.T, app *testrig.AppRig, token string, opts ...testrig.Opt) map[string]any {
	t.Helper()
	rec := app.Do(t, http.MethodGet, "/api/invitations/lookup", nil,
		append([]testrig.Opt{testrig.WithHeader(testrig.InvitationTokenHeader, token)}, opts...)...)
	if rec.Code != http.StatusOK {
		t.Fatalf("lookup: %d %s", rec.Code, rec.Body.String())
	}
	return app.JSON(t, rec)
}

func TestInvitationLookupNeedsTheHeader(t *testing.T) {
	app := testrig.App(t)
	token, _ := seedInvitation(t, app)

	for _, tc := range []struct {
		name string
		path string
		opts []testrig.Opt
	}{
		{"no header at all", "/api/invitations/lookup", nil},
		{"blank header", "/api/invitations/lookup", []testrig.Opt{testrig.WithHeader(testrig.InvitationTokenHeader, "   ")}},
		// REF §A2: the token travels in the header, never the URL. A query
		// parameter is not read, so a link that puts it there is answered as
		// if it carried no token at all.
		{"token in the query string", "/api/invitations/lookup?token=" + token, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.Do(t, http.MethodGet, tc.path, nil, tc.opts...)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != "Invitation token header is required" {
				t.Errorf("error = %q", got)
			}
		})
	}
}

func TestInvitationLookupUnknownToken(t *testing.T) {
	app := testrig.App(t)
	seedInvitation(t, app)

	rec := app.Do(t, http.MethodGet, "/api/invitations/lookup", nil,
		testrig.WithHeader(testrig.InvitationTokenHeader, "nope"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Invitation not found or no longer valid" {
		t.Errorf("error = %q", got)
	}
}

func TestInvitationLookupExpired(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)

	expired := time.Now().Add(-time.Hour)
	token := app.Invite(t, slug, inviteeEmail, "Kid", "member", &expired)

	rec := app.Do(t, http.MethodGet, "/api/invitations/lookup", nil,
		testrig.WithHeader(testrig.InvitationTokenHeader, token))
	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "This invitation has expired" {
		t.Errorf("error = %q", got)
	}

	// An invitation still marked pending in the row but past its expiry is
	// refused too: the sweep that flips the status runs nightly, and a link
	// that works until a cron job notices is not an expiry.
	if got := app.Count(t, "household_invitations", `"status" = 'pending'`); got != 1 {
		t.Errorf("pending invitations = %d, want 1 (the row is not swept by a lookup)", got)
	}
}

func TestInvitationLookupAnonymous(t *testing.T) {
	app := testrig.App(t)
	token, _ := seedInvitation(t, app)

	body := lookup(t, app, token)
	if body["accountExists"] != false {
		t.Errorf("accountExists = %v, want false", body["accountExists"])
	}
	if body["viewer"] != nil {
		t.Errorf("viewer = %v, want null for an anonymous caller", body["viewer"])
	}
	household, _ := body["household"].(map[string]any)
	if household["displayName"] != testrig.OwnerHouseholdName {
		t.Errorf("household = %v", household)
	}
	invitedBy, _ := body["invitedBy"].(map[string]any)
	if invitedBy["name"] != "Owner" {
		t.Errorf("invitedBy = %v", invitedBy)
	}
	invitation, _ := body["invitation"].(map[string]any)
	if invitation["email"] != inviteeEmail || invitation["status"] != "pending" || invitation["role"] != "member" {
		t.Errorf("invitation = %v", invitation)
	}
	// The token is a secret: it exists only in the link, never in a response.
	for key := range invitation {
		if strings.Contains(strings.ToLower(key), "token") {
			t.Errorf("lookup leaked a token-shaped key %q: %v", key, invitation)
		}
	}
}

func TestInvitationLookupReportsAnExistingAccountToAnonymousVisitors(t *testing.T) {
	app := testrig.App(t)
	token, _ := seedInvitation(t, app)
	if _, err := app.Deps.Auth.CreateUser(t.Context(), "Kid", inviteeEmail, testrig.Password); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	body := lookup(t, app, token)
	if body["accountExists"] != true {
		t.Errorf("accountExists = %v, want true", body["accountExists"])
	}
	if body["viewer"] != nil {
		t.Errorf("viewer = %v, want null", body["viewer"])
	}
}

func TestInvitationLookupReportsTheViewer(t *testing.T) {
	cases := []struct {
		name  string
		email string
		match bool
	}{
		{"the invited address", inviteeEmail, true},
		{"a different address", "someone-else@example.com", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := testrig.App(t)
			token, _ := seedInvitation(t, app)
			if _, err := app.Deps.Auth.CreateUser(t.Context(), "Existing", tc.email, testrig.Password); err != nil {
				t.Fatalf("seed account: %v", err)
			}
			cookie := app.SignIn(t, tc.email, testrig.Password)

			body := lookup(t, app, token, testrig.WithCookie(cookie))
			viewer, _ := body["viewer"].(map[string]any)
			if viewer["email"] != tc.email || viewer["emailMatches"] != tc.match {
				t.Errorf("viewer = %v, want {%q %v}", viewer, tc.email, tc.match)
			}
		})
	}
}

// --- accept -------------------------------------------------------------

func TestInvitationAcceptCreatesTheAccountAndMembership(t *testing.T) {
	app := testrig.App(t)
	token, _ := seedInvitation(t, app)

	rec := app.Do(t, http.MethodPost, "/api/invitations/accept",
		map[string]any{"name": "Kid", "password": testrig.Password},
		testrig.WithHeader(testrig.InvitationTokenHeader, token))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}

	body := app.JSON(t, rec)
	member, _ := body["member"].(map[string]any)
	if member["email"] != inviteeEmail || member["role"] != "member" || member["name"] != "Kid" {
		t.Errorf("member = %v", member)
	}
	household, _ := body["household"].(map[string]any)
	if household["slug"] != testrig.OwnerHouseholdSlug {
		t.Errorf("household = %v", household)
	}

	// REF §A2: the 201 carries the session cookie.
	var signedIn bool
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == "mi_casa_session" && cookie.Value != "" {
			signedIn = true
		}
	}
	if !signedIn {
		t.Errorf("no session cookie on 201: %v", rec.Result().Cookies())
	}

	if got := app.Count(t, "users", `"email" = $1`, inviteeEmail); got != 1 {
		t.Errorf("invited accounts = %d, want 1", got)
	}
	if got := app.Count(t, "household_memberships", `"role" = 'member'`); got != 1 {
		t.Errorf("member memberships = %d, want 1", got)
	}
	if got := app.Count(t, "household_invitations", `"status" = 'accepted'`); got != 1 {
		t.Errorf("accepted invitations = %d, want 1", got)
	}
}

func TestInvitationAcceptTellsAnExistingAccountHolderToSignIn(t *testing.T) {
	app := testrig.App(t)
	token, _ := seedInvitation(t, app)
	if _, err := app.Deps.Auth.CreateUser(t.Context(), "Kid", inviteeEmail, testrig.Password); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	rec := app.Do(t, http.MethodPost, "/api/invitations/accept",
		map[string]any{"name": "Kid", "password": testrig.Password},
		testrig.WithHeader(testrig.InvitationTokenHeader, token))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}

	body := app.JSON(t, rec)
	if body["code"] != "ACCOUNT_EXISTS" {
		t.Errorf("code = %v, want ACCOUNT_EXISTS", body["code"])
	}
	want := "An account with the invited email already exists. Sign in with it, then open the invitation link again."
	if body["error"] != want {
		t.Errorf("error = %q", body["error"])
	}
	// Nothing was accepted or created.
	if got := app.Count(t, "household_invitations", `"status" = 'pending'`); got != 1 {
		t.Errorf("pending invitations = %d, want 1", got)
	}
	if got := app.Count(t, "users", "TRUE"); got != 2 {
		t.Errorf("users = %d, want 2 (owner and the pre-existing account)", got)
	}
}

func TestInvitationAcceptUnknownTokenHasNoSideEffects(t *testing.T) {
	app := testrig.App(t)
	seedInvitation(t, app)

	rec := app.Do(t, http.MethodPost, "/api/invitations/accept",
		map[string]any{"name": "Kid", "password": testrig.Password},
		testrig.WithHeader(testrig.InvitationTokenHeader, "nope"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Invitation not found or no longer valid" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "users", "TRUE"); got != 1 {
		t.Errorf("users = %d, want 1 (only the owner)", got)
	}
}

func TestInvitationAcceptExpired(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)
	expired := time.Now().Add(-time.Minute)
	token := app.Invite(t, slug, inviteeEmail, "Kid", "member", &expired)

	rec := app.Do(t, http.MethodPost, "/api/invitations/accept",
		map[string]any{"name": "Kid", "password": testrig.Password},
		testrig.WithHeader(testrig.InvitationTokenHeader, token))
	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "This invitation has expired" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "users", "TRUE"); got != 1 {
		t.Errorf("users = %d, want 1", got)
	}
}

func TestInvitationAcceptNeedsTheHeader(t *testing.T) {
	app := testrig.App(t)
	seedInvitation(t, app)

	rec := app.Do(t, http.MethodPost, "/api/invitations/accept",
		map[string]any{"name": "Kid", "password": testrig.Password})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Invitation token header is required" {
		t.Errorf("error = %q", got)
	}
}

func TestInvitationAcceptValidatesAnonymousCredentials(t *testing.T) {
	cases := []struct {
		name string
		body any
		want string
	}{
		{"no body at all", nil, "name: name is required"},
		{"blank name", map[string]any{"name": "  ", "password": testrig.Password}, "name: name is required"},
		{"short password", map[string]any{"name": "Kid", "password": "short"}, "password: password must be at least 12 characters"},
		{"no password", map[string]any{"name": "Kid"}, "password: password is required"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := testrig.App(t)
			token, _ := seedInvitation(t, app)

			rec := app.Do(t, http.MethodPost, "/api/invitations/accept", tc.body,
				testrig.WithHeader(testrig.InvitationTokenHeader, token))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			if got := app.JSON(t, rec)["error"]; got != tc.want {
				t.Errorf("error = %q, want %q", got, tc.want)
			}
			if got := app.Count(t, "household_invitations", `"status" = 'pending'`); got != 1 {
				t.Errorf("pending invitations = %d, want 1", got)
			}
		})
	}
}

func TestInvitationAcceptRejectsMalformedJSON(t *testing.T) {
	app := testrig.App(t)
	token, _ := seedInvitation(t, app)

	req := newJSONRequest(t, http.MethodPost, "/api/invitations/accept", "{not json")
	req.Header.Set(testrig.InvitationTokenHeader, token)
	rec := app.DoRequest(req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Invalid JSON body" {
		t.Errorf("error = %q", got)
	}
}

func TestInvitationAcceptBySignedInInvitee(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)

	// Scoped to one provider, so the accept's provider-access copy is
	// exercised as well as the membership.
	household, err := app.Deps.Repo.GetHouseholdBySlug(t.Context(), slug)
	if err != nil || household == nil {
		t.Fatalf("household %q: %v", slug, err)
	}
	provider, err := app.Deps.Repo.CreateProvider(t.Context(), household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	ownerID := app.OwnerOf(t, household.ID)
	token, hash := newInvitationToken(t)
	if _, err := app.Deps.Repo.CreateInvitation(t.Context(), invitationInput(
		household.ID, inviteeEmail, "Kid", "member", hash, ownerID,
		time.Now().Add(testrig.InvitationTTL), []string{provider.ID},
	)); err != nil {
		t.Fatalf("seed invitation: %v", err)
	}

	if _, err := app.Deps.Auth.CreateUser(t.Context(), "Existing", inviteeEmail, testrig.Password); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	cookie := app.SignIn(t, inviteeEmail, testrig.Password)

	body := lookup(t, app, token, testrig.WithCookie(cookie))
	if body["accountExists"] != true {
		t.Errorf("accountExists = %v, want true", body["accountExists"])
	}

	// No body: the signed-in invitee has an account already and is not asked
	// for a password again.
	rec := app.Do(t, http.MethodPost, "/api/invitations/accept", nil,
		testrig.WithCookie(cookie), testrig.WithHeader(testrig.InvitationTokenHeader, token))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}

	accepted := app.JSON(t, rec)
	member, _ := accepted["member"].(map[string]any)
	if member["email"] != inviteeEmail || member["role"] != "member" {
		t.Errorf("member = %v", member)
	}
	if got := accepted["household"].(map[string]any)["slug"]; got != slug {
		t.Errorf("household slug = %v, want %q", got, slug)
	}

	if got := app.Count(t, "household_memberships", `"household_id" = $1 AND "role" = 'member'`, household.ID); got != 1 {
		t.Errorf("member memberships = %d, want 1", got)
	}
	if got := app.Count(t, "household_member_provider_access", "TRUE"); got != 1 {
		t.Errorf("provider access rows = %d, want 1 (the invitation's scope is copied)", got)
	}
	if got := app.Count(t, "household_invitations", `"status" = 'accepted'`); got != 1 {
		t.Errorf("accepted invitations = %d, want 1", got)
	}
}

func TestInvitationAcceptRefusesADifferentSignedInAccount(t *testing.T) {
	app := testrig.App(t)
	token, _ := seedInvitation(t, app)

	other := "someone-else@example.com"
	if _, err := app.Deps.Auth.CreateUser(t.Context(), "Other", other, testrig.Password); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	cookie := app.SignIn(t, other, testrig.Password)

	body := lookup(t, app, token, testrig.WithCookie(cookie))
	viewer, _ := body["viewer"].(map[string]any)
	if viewer["emailMatches"] != false {
		t.Errorf("viewer = %v, want emailMatches false", viewer)
	}

	rec := app.Do(t, http.MethodPost, "/api/invitations/accept", nil,
		testrig.WithCookie(cookie), testrig.WithHeader(testrig.InvitationTokenHeader, token))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	want := "You are signed in as a different account. Sign out and accept the invitation with the invited email address."
	if got := app.JSON(t, rec)["error"]; got != want {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "household_invitations", `"status" = 'pending'`); got != 1 {
		t.Errorf("pending invitations = %d, want 1", got)
	}
}

func TestInvitationRoutesAreRateLimited(t *testing.T) {
	app := testrig.App(t)
	seedInvitation(t, app)

	// 20 per 10 minutes, shared by lookup and accept: they are together the
	// one path that would tell a guesser whether a token exists.
	var last *http.Response
	for range 21 {
		last = app.Do(t, http.MethodGet, "/api/invitations/lookup", nil,
			testrig.WithHeader(testrig.InvitationTokenHeader, "nope")).Result()
	}
	if last.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("21st lookup: %d", last.StatusCode)
	}

	accept := app.Do(t, http.MethodPost, "/api/invitations/accept", nil,
		testrig.WithHeader(testrig.InvitationTokenHeader, "nope"))
	if accept.Code != http.StatusTooManyRequests {
		t.Errorf("accept after the lookup budget was spent: %d, want 429 (one shared bucket)", accept.Code)
	}
}

func TestCreateMemberHelperProducesAWorkingSession(t *testing.T) {
	app := testrig.App(t)
	_, slug := app.CompleteSetup(t)

	cookie := app.CreateMember(t, slug, inviteeEmail, "Kid", "member")
	if !strings.HasPrefix(cookie, "mi_casa_session=") {
		t.Fatalf("cookie = %q", cookie)
	}
	if got := app.Count(t, "household_memberships", `"role" = 'member'`); got != 1 {
		t.Errorf("member memberships = %d, want 1", got)
	}
}

// pgTimestamp is the pgtype spelling the generated installation queries take.
func pgTimestamp(at time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: at.UTC(), Valid: true}
}
