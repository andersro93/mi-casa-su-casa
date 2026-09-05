package auth_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// The tests drive Limen through its own HTTP handler, mounted where the real
// server mounts it, against the real database — the routes ARE the contract
// the SPA depends on, and a fake would only prove that our wrapper compiles.

const (
	testSecret   = "test-auth-secret-at-least-32-bytes-long"
	testPassword = "correct horse battery"
	testEmail    = "resident@example.test"
	testName     = "Ada Resident"
	testClientIP = "127.0.0.1"
)

// resetCall records one SendPasswordReset invocation.
type resetCall struct {
	to, name, url string
}

// env is one service instance, its mux, and a cookie jar that behaves like a
// browser: every Set-Cookie on a response is remembered and replayed, and a
// deletion cookie (empty value) removes the entry. The two-factor challenge
// travels in a cookie of its own, so a jar is not optional here.
type env struct {
	t   *testing.T
	svc auth.Service
	mux *http.ServeMux
	rig *testrig.Rig
	// clientIP is the address every request appears to come from. The auth
	// rate limiter buckets by a digest of it, so a test that needs more than
	// a rule allows moves to a second address rather than sleeping out the
	// window.
	clientIP string
	cookies  map[string]string
	resets   []resetCall
}

func newEnv(t *testing.T) *env {
	t.Helper()

	rig := testrig.Setup(t)
	e := &env{t: t, rig: rig, clientIP: testClientIP, cookies: map[string]string{}}

	svc, err := auth.New(auth.Config{
		AppURL:  "http://localhost:8080",
		AppName: "Mi Casa Su Casa",
		Secret:  testSecret,
		Pool:    rig.Pool,
		SendPasswordReset: func(_ context.Context, to, name, link string) error {
			e.resets = append(e.resets, resetCall{to: to, name: name, url: link})
			return nil
		},
	})
	if err != nil {
		t.Fatalf("auth.New: %v", err)
	}

	e.svc = svc
	e.mux = http.NewServeMux()
	e.mux.Handle(auth.BasePath+"/", svc.Handler())
	return e
}

// request builds a request carrying the jar's cookies and the client address
// every test shares.
func (e *env) request(method, path string, body any) *http.Request {
	e.t.Helper()

	var reader *strings.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("encode body: %v", err)
		}
		reader = strings.NewReader(string(encoded))
	} else {
		reader = strings.NewReader("")
	}

	r := httptest.NewRequest(method, path, reader)
	r.RemoteAddr = e.clientIP + ":54321"
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	for name, value := range e.cookies {
		r.AddCookie(&http.Cookie{Name: name, Value: value})
	}
	return r
}

// do serves the request and folds the response's cookies into the jar.
func (e *env) do(method, path string, body any) *httptest.ResponseRecorder {
	e.t.Helper()

	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, e.request(method, path, body))

	for _, cookie := range w.Result().Cookies() {
		if cookie.Value == "" || cookie.MaxAge < 0 {
			delete(e.cookies, cookie.Name)
			continue
		}
		e.cookies[cookie.Name] = cookie.Value
	}
	return w
}

func (e *env) decode(w *httptest.ResponseRecorder, into any) {
	e.t.Helper()
	if err := json.Unmarshal(w.Body.Bytes(), into); err != nil {
		e.t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
}

// createUser is the provisioning path the setup and invitation flows use —
// signup over HTTP is disabled, so this is the only way an account exists.
func (e *env) createUser(name, email, password string) string {
	e.t.Helper()
	id, err := e.svc.CreateUser(e.t.Context(), name, email, password)
	if err != nil {
		e.t.Fatalf("CreateUser: %v", err)
	}
	return id
}

func (e *env) signIn(email, password string) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.do(http.MethodPost, auth.BasePath+"/signin/credential", map[string]any{
		"credential": email,
		"password":   password,
	})
}

// TestDisabledRoutesAre404 pins the HTTP surface: every route REF §B3 turns
// off must be absent from the router, not merely rejected by a handler.
// Public sign-up in particular is the difference between an invite-only
// household and an open one.
func TestDisabledRoutesAre404(t *testing.T) {
	e := newEnv(t)

	cases := []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/signup/credential", map[string]any{"email": "a@b.test", "password": testPassword}},
		{http.MethodPut, "/passwords", map[string]any{"new_password": testPassword}},
		{http.MethodPost, "/usernames/check", map[string]any{"username": "ada"}},
		{http.MethodPost, "/verify-email", map[string]any{"token": "x"}},
		{http.MethodPost, "/email-verifications", nil},
		{http.MethodPost, "/two-factor/otp/send", nil},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			w := e.do(tc.method, auth.BasePath+tc.path, tc.body)
			if w.Code != http.StatusNotFound {
				t.Fatalf("want 404, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

// TestSignInIssuesCookieAndMeReturnsEmail is the whole sign-in contract in
// one test: the cookie is ours by name, and the session it names resolves.
func TestSignInIssuesCookieAndMeReturnsEmail(t *testing.T) {
	e := newEnv(t)
	e.createUser(testName, testEmail, testPassword)

	w := e.signIn(testEmail, testPassword)
	if w.Code != http.StatusOK {
		t.Fatalf("sign in: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if e.cookies[auth.CookieName] == "" {
		t.Fatalf("no %s cookie in %v", auth.CookieName, w.Result().Cookies())
	}

	me := e.do(http.MethodGet, auth.BasePath+"/me", nil)
	if me.Code != http.StatusOK {
		t.Fatalf("me: want 200, got %d: %s", me.Code, me.Body.String())
	}
	if !strings.Contains(me.Body.String(), testEmail) {
		t.Fatalf("me body %q does not contain %q", me.Body.String(), testEmail)
	}
}

func TestSignInWithWrongPasswordIsUnauthorized(t *testing.T) {
	e := newEnv(t)
	e.createUser(testName, testEmail, testPassword)

	w := e.signIn(testEmail, "not the password")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", w.Code, w.Body.String())
	}
	if e.cookies[auth.CookieName] != "" {
		t.Fatal("a failed sign-in issued a session cookie")
	}
}

// TestCreateUserPasswordBounds covers both ends of the 12..128 policy
// (REF §A8). The lower bound is Limen's; the upper one is ours, because the
// credential plugin has no maximum-length option and an unbounded password
// is an Argon2 denial-of-service.
func TestCreateUserPasswordBounds(t *testing.T) {
	e := newEnv(t)

	if _, err := e.svc.CreateUser(t.Context(), testName, "short@example.test", "elevenchars"); err == nil {
		t.Fatal("an 11-character password was accepted")
	}
	if _, err := e.svc.CreateUser(t.Context(), testName, "long@example.test", strings.Repeat("x", 129)); err == nil {
		t.Fatal("a 129-character password was accepted")
	}
	if _, err := e.svc.CreateUser(t.Context(), testName, "ok@example.test", strings.Repeat("x", 128)); err != nil {
		t.Fatalf("a 128-character password was rejected: %v", err)
	}
}

func TestSessionFromRequest(t *testing.T) {
	e := newEnv(t)
	userID := e.createUser(testName, testEmail, testPassword)

	t.Run("no cookie", func(t *testing.T) {
		session, err := e.svc.SessionFromRequest(httptest.NewRequest(http.MethodGet, "/api/settings", nil))
		if err != nil {
			t.Fatalf("SessionFromRequest: %v", err)
		}
		if session != nil {
			t.Fatalf("want nil session, got %+v", session)
		}
	})

	t.Run("after sign in", func(t *testing.T) {
		e.signIn(testEmail, testPassword)

		session, err := e.svc.SessionFromRequest(e.request(http.MethodGet, "/api/settings", nil))
		if err != nil {
			t.Fatalf("SessionFromRequest: %v", err)
		}
		if session == nil {
			t.Fatal("want a session, got nil")
		}
		if session.UserID != userID {
			t.Errorf("UserID = %q, want %q", session.UserID, userID)
		}
		if session.Email != testEmail {
			t.Errorf("Email = %q, want %q", session.Email, testEmail)
		}
		if session.Name != testName {
			t.Errorf("Name = %q, want %q", session.Name, testName)
		}
		if session.Token != e.cookies[auth.CookieName] {
			t.Errorf("Token = %q, want the cookie value", session.Token)
		}
		if session.SessionID == "" {
			t.Error("SessionID is empty")
		}
		if session.TwoFactorEnabled {
			t.Error("TwoFactorEnabled is true for an account that never enrolled")
		}
	})
}

// TestSessionMetadataStoresAnIPDigest is the privacy guarantee from REF §A8:
// a database dump must not be a log of who signed in from where.
func TestSessionMetadataStoresAnIPDigest(t *testing.T) {
	e := newEnv(t)
	e.createUser(testName, testEmail, testPassword)
	e.signIn(testEmail, testPassword)

	var metadata string
	err := e.rig.Pool.QueryRow(t.Context(), `SELECT "metadata" FROM "sessions"`).Scan(&metadata)
	if err != nil {
		t.Fatalf("read session metadata: %v", err)
	}

	if strings.Contains(metadata, "127.0.0.1") {
		t.Fatalf("session metadata holds the raw address: %s", metadata)
	}
	digest := e.svc.IPDigest()("127.0.0.1")
	if !strings.Contains(metadata, digest) {
		t.Fatalf("session metadata %s does not hold the digest %s", metadata, digest)
	}
}

// TestPasswordResetFlow follows the whole recovery path: the mail we would
// send, the token that arrives back, and the sessions the reset must end.
func TestPasswordResetFlow(t *testing.T) {
	e := newEnv(t)
	e.createUser(testName, testEmail, testPassword)
	e.signIn(testEmail, testPassword)
	oldSession := e.cookies[auth.CookieName]

	w := e.do(http.MethodPost, auth.BasePath+"/passwords/request-reset", map[string]any{"email": testEmail})
	if w.Code != http.StatusOK {
		t.Fatalf("request-reset: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if len(e.resets) != 1 {
		t.Fatalf("want 1 reset mail, got %d", len(e.resets))
	}

	sent := e.resets[0]
	if sent.to != testEmail {
		t.Errorf("to = %q, want %q", sent.to, testEmail)
	}
	if sent.name != testName {
		t.Errorf("name = %q, want %q", sent.name, testName)
	}
	if !strings.HasPrefix(sent.url, "http://localhost:8080/reset-password?token=") {
		t.Fatalf("url = %q, want APP_URL/reset-password?token=…", sent.url)
	}

	parsed, err := url.Parse(sent.url)
	if err != nil {
		t.Fatalf("parse reset url: %v", err)
	}
	token := parsed.Query().Get("token")
	if token == "" {
		t.Fatal("reset url carries no token")
	}

	const newPassword = "a whole new passphrase"
	w = e.do(http.MethodPost, auth.BasePath+"/passwords/reset", map[string]any{
		"token": token,
		// snake_case, not the camelCase REF §B3 lists: the credential
		// plugin's validator reads "new_password" (handlers.go).
		"new_password": newPassword,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("reset: want 200, got %d: %s", w.Code, w.Body.String())
	}

	// The session that existed before the reset must be gone: a reset is
	// either a recovery or a response to a compromise, and both want it.
	e.cookies[auth.CookieName] = oldSession
	if me := e.do(http.MethodGet, auth.BasePath+"/me", nil); me.Code == http.StatusOK {
		t.Fatal("the session from before the reset still works")
	}
	delete(e.cookies, auth.CookieName)

	if w := e.signIn(testEmail, testPassword); w.Code == http.StatusOK {
		t.Fatal("the old password still signs in")
	}
	if w := e.signIn(testEmail, newPassword); w.Code != http.StatusOK {
		t.Fatalf("sign in with the new password: want 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestTwoFactorFlow walks enrolment, a challenged sign-in, a backup code, and
// disabling — the four things REF §A8 promises about two-factor.
func TestTwoFactorFlow(t *testing.T) {
	e := newEnv(t)
	e.createUser(testName, testEmail, testPassword)

	if w := e.signIn(testEmail, testPassword); w.Code != http.StatusOK {
		t.Fatalf("sign in: %d %s", w.Code, w.Body.String())
	}

	// Enrolment needs the password, not just a session.
	w := e.do(http.MethodPost, auth.BasePath+"/two-factor/initiate-setup", map[string]any{"password": testPassword})
	if w.Code != http.StatusOK {
		t.Fatalf("initiate-setup: want 200, got %d: %s", w.Code, w.Body.String())
	}
	var setup struct {
		URI string `json:"uri"`
	}
	e.decode(w, &setup)
	secret := totpSecret(t, setup.URI)

	w = e.do(http.MethodPost, auth.BasePath+"/two-factor/finalize-setup", map[string]any{"code": totpCode(t, secret)})
	if w.Code != http.StatusOK {
		t.Fatalf("finalize-setup: want 200, got %d: %s", w.Code, w.Body.String())
	}

	var enabled bool
	if err := e.rig.Pool.QueryRow(t.Context(), `SELECT "two_factor_enabled" FROM "users" WHERE "email" = $1`, testEmail).Scan(&enabled); err != nil {
		t.Fatalf("read two_factor_enabled: %v", err)
	}
	if !enabled {
		t.Fatal("two_factor_enabled is still false after finalize-setup")
	}

	// Ten backup codes, read while the enrolment session is still live.
	w = e.do(http.MethodGet, auth.BasePath+"/two-factor/backup-codes", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("backup-codes: want 200, got %d: %s", w.Code, w.Body.String())
	}
	var backupCodes []string
	e.decode(w, &backupCodes)
	if len(backupCodes) != 10 {
		t.Fatalf("want 10 backup codes, got %d", len(backupCodes))
	}

	delete(e.cookies, auth.CookieName)

	// A challenged sign-in answers 200 with a flag and NO session cookie.
	w = e.signIn(testEmail, testPassword)
	if w.Code != http.StatusOK {
		t.Fatalf("challenged sign in: want 200, got %d: %s", w.Code, w.Body.String())
	}
	var challenge struct {
		TwoFactorRequired bool `json:"two_factor_required"`
	}
	e.decode(w, &challenge)
	if !challenge.TwoFactorRequired {
		t.Fatalf("want two_factor_required, got %s", w.Body.String())
	}
	if e.cookies[auth.CookieName] != "" {
		t.Fatal("a challenged sign-in issued a session cookie")
	}

	w = e.do(http.MethodPost, auth.BasePath+"/two-factor/verify", map[string]any{"code": totpCode(t, secret)})
	if w.Code != http.StatusOK {
		t.Fatalf("verify: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if e.cookies[auth.CookieName] == "" {
		t.Fatal("verify issued no session cookie")
	}

	// The rest of this test needs four more sign-ins, and the limiter allows
	// five a minute per address; a second client picks up where the first
	// runs out (TestSignInRateLimit covers the limit itself).
	e.clientIP = "127.0.0.2"

	// A backup code completes a challenge exactly once.
	delete(e.cookies, auth.CookieName)
	e.signIn(testEmail, testPassword)
	w = e.do(http.MethodPost, auth.BasePath+"/two-factor/verify", map[string]any{"code": backupCodes[0]})
	if w.Code != http.StatusOK {
		t.Fatalf("verify with a backup code: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if e.cookies[auth.CookieName] == "" {
		t.Fatal("backup-code verify issued no session cookie")
	}

	session := e.cookies[auth.CookieName]
	delete(e.cookies, auth.CookieName)
	e.signIn(testEmail, testPassword)
	if w := e.do(http.MethodPost, auth.BasePath+"/two-factor/verify", map[string]any{"code": backupCodes[0]}); w.Code == http.StatusOK {
		t.Fatal("a spent backup code was accepted a second time")
	}

	// Disabling needs the password; afterwards sign-in issues a cookie again.
	e.cookies[auth.CookieName] = session
	w = e.do(http.MethodPost, auth.BasePath+"/two-factor/disable", map[string]any{"password": testPassword})
	if w.Code != http.StatusOK {
		t.Fatalf("disable: want 200, got %d: %s", w.Code, w.Body.String())
	}

	delete(e.cookies, auth.CookieName)
	if w := e.signIn(testEmail, testPassword); w.Code != http.StatusOK {
		t.Fatalf("sign in after disable: want 200, got %d: %s", w.Code, w.Body.String())
	}
	if e.cookies[auth.CookieName] == "" {
		t.Fatal("sign-in after disable issued no session cookie")
	}
}

// TestSignInRateLimit pins REF §A8's brake on credential stuffing: five
// attempts a minute per client address, wrong password or right.
func TestSignInRateLimit(t *testing.T) {
	e := newEnv(t)
	e.createUser(testName, testEmail, testPassword)

	for attempt := 1; attempt <= 5; attempt++ {
		if w := e.signIn(testEmail, "wrong"); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: want 401, got %d: %s", attempt, w.Code, w.Body.String())
		}
	}
	if w := e.signIn(testEmail, testPassword); w.Code != http.StatusTooManyRequests {
		t.Fatalf("sixth attempt: want 429, got %d: %s", w.Code, w.Body.String())
	}

	// The bucket is per client, so another household member is unaffected.
	e.clientIP = "127.0.0.2"
	if w := e.signIn(testEmail, testPassword); w.Code != http.StatusOK {
		t.Fatalf("another client: want 200, got %d: %s", w.Code, w.Body.String())
	}
}

// TestSignInMintsASessionForAUser covers the setup and invite-accept paths,
// which have an account but never a password to sign in with.
func TestSignInMintsASessionForAUser(t *testing.T) {
	e := newEnv(t)
	userID := e.createUser(testName, testEmail, testPassword)

	w := httptest.NewRecorder()
	r := e.request(http.MethodPost, "/api/setup/complete", nil)
	if err := e.svc.SignIn(t.Context(), w, r, userID); err != nil {
		t.Fatalf("SignIn: %v", err)
	}

	cookies := w.Result().Cookies()
	var token string
	for _, cookie := range cookies {
		if cookie.Name == auth.CookieName {
			token = cookie.Value
		}
	}
	if token == "" {
		t.Fatalf("SignIn set no %s cookie: %v", auth.CookieName, cookies)
	}

	e.cookies[auth.CookieName] = token
	if me := e.do(http.MethodGet, auth.BasePath+"/me", nil); me.Code != http.StatusOK {
		t.Fatalf("me with the minted session: want 200, got %d: %s", me.Code, me.Body.String())
	}
}

func TestRevokeSessionAndRevokeAllSessions(t *testing.T) {
	e := newEnv(t)
	userID := e.createUser(testName, testEmail, testPassword)

	e.signIn(testEmail, testPassword)
	first := e.cookies[auth.CookieName]
	if err := e.svc.RevokeSession(t.Context(), first); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}
	if me := e.do(http.MethodGet, auth.BasePath+"/me", nil); me.Code == http.StatusOK {
		t.Fatal("a revoked session still works")
	}

	delete(e.cookies, auth.CookieName)
	e.signIn(testEmail, testPassword)
	if err := e.svc.RevokeAllSessions(t.Context(), userID); err != nil {
		t.Fatalf("RevokeAllSessions: %v", err)
	}
	if me := e.do(http.MethodGet, auth.BasePath+"/me", nil); me.Code == http.StatusOK {
		t.Fatal("a session survived RevokeAllSessions")
	}
}

func TestDeleteUser(t *testing.T) {
	e := newEnv(t)
	userID := e.createUser(testName, testEmail, testPassword)
	e.signIn(testEmail, testPassword)

	if err := e.svc.DeleteUser(t.Context(), userID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}

	var users int
	if err := e.rig.Pool.QueryRow(t.Context(), `SELECT count(*) FROM "users"`).Scan(&users); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if users != 0 {
		t.Fatalf("want 0 users, got %d", users)
	}

	// The sessions cascade away with the row, so the cookie stops working
	// without anything having to remember to revoke it.
	var sessions int
	if err := e.rig.Pool.QueryRow(t.Context(), `SELECT count(*) FROM "sessions"`).Scan(&sessions); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if sessions != 0 {
		t.Fatalf("want 0 sessions, got %d", sessions)
	}
}

// totpSecret pulls the shared secret out of the otpauth:// URI the enrolment
// route hands the browser for its QR code.
func totpSecret(t *testing.T, uri string) string {
	t.Helper()

	parsed, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("parse otpauth uri %q: %v", uri, err)
	}
	secret := parsed.Query().Get("secret")
	if secret == "" {
		t.Fatalf("otpauth uri %q carries no secret", uri)
	}
	if issuer := parsed.Query().Get("issuer"); issuer != "Mi Casa Su Casa" {
		t.Fatalf("issuer = %q, want the app name", issuer)
	}
	return secret
}

func totpCode(t *testing.T, secret string) string {
	t.Helper()

	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate totp code: %v", err)
	}
	return code
}
