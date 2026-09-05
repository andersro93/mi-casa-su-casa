// This file adds the HTTP-level rig on top of Setup's Postgres rig: a full
// api.NewHandler wired against real collaborators (a real Limen auth service,
// the Postgres-backed rate limiter, a recording mail sender), driven with real
// *http.Request / httptest.ResponseRecorder round trips rather than by calling
// handler functions directly.
//
// It is the Go port of test/integration/helpers.ts plus setup.ts: a route test
// builds on AppRig instead of reassembling api.Deps by hand, and — because the
// whole chain is present — a test proving a route's behaviour also proves that
// the route is mounted, validated, guarded and limited the way it is meant to
// be.
package testrig

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/security"
)

const (
	// AppURL is http:, deliberately: auth.New marks the session cookie Secure
	// only for an https app URL, and the rig drives requests through
	// httptest.NewRequest rather than a TLS listener — a Secure cookie would
	// be set but never sent back.
	AppURL = "http://127.0.0.1"

	// AuthSecret is a fixed value of the 32+ bytes auth.New insists on.
	AuthSecret = "mi-casa-testrig-auth-secret-0123456789"

	// SetupSecret and OwnerEmail are the first-run gate's two halves, fixed so
	// a test can post a valid setup body without inventing them.
	SetupSecret = "test-setup-secret"
	OwnerEmail  = "owner@example.com"

	// EmailDomain is what GET /api/setup/status reports.
	EmailDomain = "inbox.example.com"

	// Password is the credential every rig-created account gets. Long enough
	// for REF §A8's 12-character minimum with room to spare.
	Password = "averylongpassword123"

	// OwnerHouseholdSlug and OwnerHouseholdName are what CompleteSetup creates.
	OwnerHouseholdSlug = "casa"
	OwnerHouseholdName = "Casa"
)

// AppRig is the HTTP-level test rig: a full api.NewHandler over a real,
// isolated Postgres (the embedded *Rig), with the outbound mailer swapped for
// a recorder and the clock swappable.
//
// Like Setup's Rig it belongs to ONE test: the underlying database is
// truncated per Setup call, so two rigs in flight at once would see each
// other's rows.
type AppRig struct {
	Rig  *Rig
	Deps api.Deps
	// Handler is what api.NewHandler built: the whole chain, exactly as
	// cmd/mi-casa mounts it.
	Handler http.Handler
	// Mail records what the app tried to send.
	Mail *mail.RecordingSender

	mu    sync.Mutex
	clock time.Time // zero => wall clock (see SetNow)
}

// App builds an AppRig. The collaborators are the real ones wherever a real
// one can run in a test — Limen against the rig's Postgres, the Postgres rate
// limiter — and a double only where delivery would leave the process (mail).
func App(t *testing.T) *AppRig {
	t.Helper()

	rig := Setup(t)
	app := &AppRig{Rig: rig, Mail: &mail.RecordingSender{}}

	svc, err := auth.New(auth.Config{
		AppURL:  AppURL,
		AppName: "Mi Casa Su Casa",
		Secret:  AuthSecret,
		Pool:    rig.Pool,
		SendPasswordReset: func(ctx context.Context, to, name, link string) error {
			return app.Mail.Send(ctx, mail.PasswordReset(to, name, link))
		},
	})
	if err != nil {
		t.Fatalf("testrig: auth.New: %v", err)
	}

	repository := repo.New(rig.Pool)
	app.Deps = api.Deps{
		Pool:      rig.Pool,
		Q:         rig.Q,
		Auth:      svc,
		Repo:      repository,
		RateLimit: ratelimit.NewPostgres(repository),
		Mail:      app.Mail,
		// The inbound webhook's two halves: the key MailgunForm signs with,
		// and a guard of this rig's own so one test's tokens cannot make
		// another test's delivery look like a replay.
		MailgunSigningKey: MailgunSigningKey,
		Replay:            mail.NewReplayGuard(),
		IPDigest:          svc.IPDigest(),
		Now:               app.now,
		AppURL:            AppURL,
		AppName:           "Mi Casa Su Casa",
		EmailDomain:       EmailDomain,
		SetupSecret:       SetupSecret,
		OwnerEmail:        OwnerEmail,
	}
	app.Handler = api.NewHandler(app.Deps)
	return app
}

// now backs api.Deps.Now: the wall clock unless SetNow pinned it.
func (a *AppRig) now() time.Time {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.clock.IsZero() {
		return time.Now()
	}
	return a.clock
}

// SetNow pins the clock every handler reads through Deps.Now — invitation
// expiry, the setup claim's staleness window, rate-limit windows. Pass the
// zero time.Time to go back to the wall clock.
//
// It does NOT move the database's own now(): rows written while the clock is
// pinned still carry real timestamps. That is deliberate — the comparisons
// this exists to control are all made in Go.
func (a *AppRig) SetNow(at time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.clock = at
}

// Advance moves the pinned clock forward by d, starting from the wall clock if
// nothing was pinned yet.
func (a *AppRig) Advance(d time.Duration) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.clock.IsZero() {
		a.clock = time.Now()
	}
	a.clock = a.clock.Add(d)
}

// Opt customises one request. The two that exist cover everything the route
// tests need; a test wanting more should reach for DoRequest.
type Opt func(*http.Request)

// WithCookie attaches a Cookie header value, as returned by SignIn or
// CompleteSetup.
func WithCookie(cookie string) Opt {
	return func(r *http.Request) {
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
	}
}

// WithHeader sets one header — the invitation token, above all.
func WithHeader(name, value string) Opt {
	return func(r *http.Request) { r.Header.Set(name, value) }
}

// WithoutOrigin removes the Origin header Do sets on every mutation, for the
// tests that exercise the same-site guard itself.
func WithoutOrigin() Opt {
	return func(r *http.Request) { r.Header.Del("Origin") }
}

// Do issues one request against the whole handler and returns the recorder.
//
// body is marshalled as JSON; nil sends no body at all, which is a distinct
// case the routes care about (a signed-in invitation accept sends none).
//
// Every non-GET request carries Origin: AppURL, because both guards in front
// of these routes demand it — api's own SameSite middleware and, for
// /api/auth/*, Limen's trusted-origin check. A browser sets it without being
// asked; a test has to say it out loud. Use WithoutOrigin to take it away on
// purpose.
func (a *AppRig) Do(t *testing.T, method, path string, body any, opts ...Opt) *httptest.ResponseRecorder {
	t.Helper()

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("testrig: marshal body for %s %s: %v", method, path, err)
		}
		reader = bytes.NewReader(encoded)
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead {
		req.Header.Set("Origin", AppURL)
	}
	for _, opt := range opts {
		opt(req)
	}

	return a.DoRequest(req)
}

// DoRequest drives a request the caller built themselves — for the handful of
// cases Do's JSON-body convenience cannot express.
func (a *AppRig) DoRequest(req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	a.Handler.ServeHTTP(rec, req)
	return rec
}

// JSON decodes a response body as a JSON object, failing the test when it is
// not one. Assertions then read as ordinary map lookups rather than as another
// round of struct declarations per test.
func (a *AppRig) JSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("testrig: decode response (%d): %v\nbody: %s", rec.Code, err, rec.Body.String())
	}
	return body
}

// CompleteSetup runs the real first-run flow over HTTP — POST
// /api/setup/complete with the rig's owner credentials — and returns the
// owner's Cookie header value and the slug of the household it created.
//
// It goes through the route rather than seeding rows directly, because the
// state it leaves behind (a complete installation, an owner, a household, an
// audit row, a live session) is exactly what a signed-in test needs and is
// tedious to fake correctly.
func (a *AppRig) CompleteSetup(t *testing.T) (cookie, slug string) {
	t.Helper()

	rec := a.Do(t, http.MethodPost, "/api/setup/complete", map[string]any{
		"email":         OwnerEmail,
		"name":          "Owner",
		"password":      Password,
		"householdName": OwnerHouseholdName,
		"householdSlug": OwnerHouseholdSlug,
		"setupSecret":   SetupSecret,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("testrig: CompleteSetup: %d %s", rec.Code, rec.Body.String())
	}

	return sessionCookie(t, rec), OwnerHouseholdSlug
}

// SignIn drives the real credential sign-in route and returns a ready-to-use
// Cookie header value.
func (a *AppRig) SignIn(t *testing.T, email, password string) string {
	t.Helper()

	rec := a.Do(t, http.MethodPost, auth.BasePath+"/signin/credential", map[string]any{
		"credential": email,
		"password":   password,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("testrig: SignIn(%q): %d %s", email, rec.Code, rec.Body.String())
	}
	return sessionCookie(t, rec)
}

// CreateMember invites somebody to the household named by slug and accepts the
// invitation anonymously, returning the new member's Cookie header value.
//
// The invitation is written through the repository rather than through the
// owner's admin route: that route belongs to a later task, and a rig helper
// should not be the reason a test fails. The ACCEPT half goes over HTTP,
// because that is the route under test's own counterpart and the session
// cookie only exists if it really ran.
func (a *AppRig) CreateMember(t *testing.T, slug, email, name, role string) string {
	t.Helper()

	token := a.Invite(t, slug, email, name, role, nil)
	rec := a.Do(t, http.MethodPost, "/api/invitations/accept",
		map[string]any{"name": name, "password": Password},
		WithHeader(InvitationTokenHeader, token))
	if rec.Code != http.StatusCreated {
		t.Fatalf("testrig: CreateMember(%q): %d %s", email, rec.Code, rec.Body.String())
	}
	return sessionCookie(t, rec)
}

// InvitationTokenHeader is where an invitation token travels (REF §A2): a
// header, never the URL, so the secret stays out of logs and Referers.
const InvitationTokenHeader = "X-Invitation-Token"

// InvitationTTL is REF §A3's invitation lifetime, so a test that wants an
// expired invitation can say so in the same units the app does.
const InvitationTTL = 7 * 24 * time.Hour

// Invite writes a pending invitation for the household named by slug, sent by
// that household's owner, and returns the plaintext token — the value that
// would be in the invite link.
//
// expiresAt nil means the ordinary seven days from the rig's clock; pass a
// time to make an invitation that is already expired.
func (a *AppRig) Invite(t *testing.T, slug, email, name, role string, expiresAt *time.Time) string {
	t.Helper()
	ctx := t.Context()

	household, err := a.Deps.Repo.GetHouseholdBySlug(ctx, slug)
	if err != nil || household == nil {
		t.Fatalf("testrig: Invite: household %q not found (%v)", slug, err)
	}
	ownerID := a.OwnerOf(t, household.ID)

	token, hash, err := security.NewInvitationToken()
	if err != nil {
		t.Fatalf("testrig: Invite: mint token: %v", err)
	}

	expiry := a.now().Add(InvitationTTL)
	if expiresAt != nil {
		expiry = *expiresAt
	}

	if _, err := a.Deps.Repo.CreateInvitation(ctx, repo.CreateInvitationInput{
		HouseholdID:     household.ID,
		Email:           email,
		Name:            name,
		Role:            role,
		TokenHash:       hash,
		InvitedByUserID: ownerID,
		ExpiresAt:       expiry,
	}); err != nil {
		t.Fatalf("testrig: Invite(%q): %v", email, err)
	}
	return token
}

// OwnerOf returns the user id of a household's first owner.
func (a *AppRig) OwnerOf(t *testing.T, householdID string) string {
	t.Helper()

	var userID string
	err := a.Rig.Pool.QueryRow(t.Context(), `
		SELECT "user_id" FROM "household_memberships"
		WHERE "household_id" = $1 AND "role" = 'owner'
		ORDER BY "created_at" LIMIT 1`, householdID).Scan(&userID)
	if err != nil {
		t.Fatalf("testrig: OwnerOf(%q): %v", householdID, err)
	}
	return userID
}

// Count runs `SELECT count(*) FROM <table> WHERE <where>`, the Go counterpart
// of test/integration/helpers.ts's count(). The table and predicate are
// interpolated because both are test-authored literals; values go through
// parameters as usual.
func (a *AppRig) Count(t *testing.T, table, where string, args ...any) int {
	t.Helper()

	if strings.TrimSpace(where) == "" {
		where = "TRUE"
	}
	var total int
	if err := a.Rig.Pool.QueryRow(t.Context(),
		`SELECT count(*) FROM "`+table+`" WHERE `+where, args...,
	).Scan(&total); err != nil {
		t.Fatalf("testrig: Count(%q, %q): %v", table, where, err)
	}
	return total
}

// InstallationStatus is the app_installation singleton's current state.
func (a *AppRig) InstallationStatus(t *testing.T) string {
	t.Helper()
	installation, err := a.Rig.Q.GetInstallation(t.Context())
	if err != nil {
		t.Fatalf("testrig: InstallationStatus: %v", err)
	}
	return installation.Status
}

// sessionCookie extracts the session cookie a response set, as a ready-to-use
// Cookie header value. It fails the test when there is none: every caller here
// asserts on a response that is supposed to sign somebody in, so a missing
// cookie is the failure, not a condition to handle.
func sessionCookie(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == auth.CookieName && cookie.Value != "" {
			return cookie.Name + "=" + cookie.Value
		}
	}
	t.Fatalf("testrig: no %s cookie in response: %v", auth.CookieName, rec.Result().Cookies())
	return ""
}
