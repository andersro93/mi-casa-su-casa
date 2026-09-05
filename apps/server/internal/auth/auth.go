// Package auth is the ONLY package in this module that imports Limen.
//
// Everything outside it — the HTTP layer, the setup and invitation flows,
// the settings screen's backend — consumes the Service interface and the
// Session struct declared here, and never a Limen type. That boundary is not
// decoration: Limen's plugins are pre-1.0, its identifiers are typed `any`,
// and its schema is discovered rather than declared. Any of that can change
// under us; the blast radius has to stop at this package.
//
// It replaces the Workers deployment's Better Auth instance (REF §A8): email
// and password sign-in with TOTP two-factor, no public sign-up, sessions in
// Postgres, and client addresses stored only as keyed digests.
package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/thecodearcher/limen"
	sqladapter "github.com/thecodearcher/limen/adapters/sql"
	credentialpassword "github.com/thecodearcher/limen/plugins/credential-password"
	twofactor "github.com/thecodearcher/limen/plugins/two-factor"

	"github.com/andersro93/mi-casa-su-casa/server/internal/security"
)

// BasePath is where the auth routes live. Limen's router matches the FULL
// request path (its base path is a router group, not a prefix that gets
// stripped), so the value here and the mount point in the HTTP server must
// agree exactly — mounting Handler() anywhere else yields 404s for every auth
// route, with no error at startup to explain it.
const BasePath = "/api/auth"

// CookieName is pinned rather than left to Limen's default ("limen_session")
// so the two cannot drift apart under a library upgrade, and so the name in a
// browser's cookie jar says which application put it there. The cookie is
// HttpOnly; no client reads it by name.
const CookieName = "mi_casa_session"

// Password policy, carried over from the Workers deployment (REF §A8): length
// only, no composition rules.
//
// PasswordMinLength is handed to Limen, which enforces it on every path it
// owns (sign-up, reset, change). PasswordMaxLength has no Limen equivalent —
// the credential plugin offers WithPasswordMinLength and nothing for the
// upper bound — so it is enforced in CreateUser, the only account-creation
// path this application has. Passwords arriving over Limen's own reset and
// change routes are bounded only by the request body limit; Argon2id over a
// long input is the denial-of-service that motivates the cap, so if those
// routes ever need it too the guard belongs in a middleware on Handler().
const (
	PasswordMinLength = 12
	PasswordMaxLength = 128
)

// ErrPasswordLength says a password was rejected before it was hashed or
// stored. Callers map it to a 400: the input is wrong, not the server.
var ErrPasswordLength = fmt.Errorf("auth: password must be between %d and %d characters", PasswordMinLength, PasswordMaxLength)

// Session is what the rest of the app knows about the caller.
//
// SessionID is the sessions row id (what the settings screen's device list
// addresses); Token is the opaque value in the cookie, which only this
// package and Limen should ever handle.
type Session struct {
	UserID           string
	Email            string
	Name             string
	Token            string
	SessionID        string
	TwoFactorEnabled bool
}

// Config is everything the auth service needs from the composition root. It
// takes an already-open pool rather than a URL: one process, one pool.
type Config struct {
	AppURL  string
	AppName string
	// Secret is AUTH_SECRET. Limen requires exactly 32 bytes and ours is a
	// free-form string of at least 32; New hashes it (see below).
	Secret string
	Pool   *pgxpool.Pool
	// TrustedProxyHops mirrors config.Config: how many proxies sit in front,
	// so X-Forwarded-For can be read from the right end. 0 means the header
	// is ignored entirely.
	TrustedProxyHops int
	// SendPasswordReset delivers the reset link. It is called from Limen's
	// request-reset handler, which has no context of its own and ignores the
	// result, so an error here is logged by the caller and nothing else: the
	// route still answers 200, deliberately, so it cannot be used to probe
	// which addresses have accounts.
	SendPasswordReset func(ctx context.Context, to, name, url string) error
}

// Service is the entire auth surface the rest of the app may use.
type Service interface {
	// Handler is Limen's router. Mount it at BasePath + "/".
	Handler() http.Handler

	// SessionFromRequest resolves the caller, returning (nil, nil) — not an
	// error — for every flavour of "nobody is signed in": no cookie, an
	// expired session, a token whose row has been revoked, a user who has
	// been deleted.
	SessionFromRequest(r *http.Request) (*Session, error)

	// CreateUser creates an account. Sign-up over HTTP is disabled, so this
	// is the only way one comes into existence: first-run setup and
	// invitation acceptance.
	CreateUser(ctx context.Context, name, email, password string) (userID string, err error)

	// SignIn mints a session for an account that has just been created and
	// writes the cookie on w, so setup and invite-accept can hand the browser
	// a signed-in state without a round trip through the sign-in form.
	SignIn(ctx context.Context, w http.ResponseWriter, r *http.Request, userID string) error

	// RevokeAllSessions signs a user out everywhere.
	RevokeAllSessions(ctx context.Context, userID string) error

	// RevokeSession signs out the one session a token names.
	RevokeSession(ctx context.Context, token string) error

	// DeleteUser removes the account and everything that hangs off it.
	DeleteUser(ctx context.Context, userID string) error

	// IPDigest is the keyed digest the session metadata and the auth rate
	// limiter are built from, exposed so the app's own limiter buckets a
	// caller the same way.
	IPDigest() func(string) string
}

type service struct {
	limen *limen.Limen
	core  *limen.LimenCore
	cred  credentialpassword.API
	pool  *pgxpool.Pool
	// handler is built once, in New. Limen's Handler() is a CONSTRUCTOR, not
	// an accessor: it re-registers every route and, on the way, its
	// resolveRuleOverride DELETES each matched custom rule from the shared
	// rate-limiter config map. A second call would therefore hand back a
	// router whose sign-in, reset and two-factor limits had silently fallen
	// back to the 60/min default — the brake quietly loosened by the act of
	// asking for the handler twice.
	handler  http.Handler
	ipDigest func(string) string
	appURL   string
	// sendReset is Config.SendPasswordReset, kept so the closure Limen holds
	// can reach it after New returns.
	sendReset func(ctx context.Context, to, name, url string) error
}

var _ Service = (*service)(nil)

// New builds the Limen instance and wires it to our schema (REF §B1).
//
// The instance is built ONCE, at startup, and shared by every request — not
// per-request as the Workers deployment had to be, because the D1 binding
// only existed inside the handler.
func New(cfg Config) (Service, error) {
	switch {
	case cfg.Pool == nil:
		return nil, errors.New("auth: a database pool is required")
	case cfg.AppURL == "":
		return nil, errors.New("auth: AppURL is required")
	case cfg.AppName == "":
		return nil, errors.New("auth: AppName is required")
	case len(cfg.Secret) < 32:
		return nil, errors.New("auth: Secret must be at least 32 bytes")
	}

	s := &service{
		pool:      cfg.Pool,
		ipDigest:  security.IPDigest(cfg.Secret),
		appURL:    strings.TrimRight(cfg.AppURL, "/"),
		sendReset: cfg.SendPasswordReset,
	}

	// Limen speaks database/sql, we speak pgx. OpenDBFromPool wraps the pool
	// we were handed rather than opening a second one, so there is still
	// exactly one connection pool in the process. The *sql.DB borrows from
	// the pool and is finished when the pool is closed by its owner.
	sqlDB := stdlib.OpenDBFromPool(cfg.Pool)

	// Limen requires exactly 32 bytes; AUTH_SECRET is a free-form string of
	// at least 32. Hashing gives a stable 32-byte key from any valid secret
	// without asking operators to count characters. The two-factor plugin
	// inherits this same key for encrypting TOTP secrets at rest — see
	// twoFactorPlugin below for why it is not given one of its own.
	//
	// NEVER set LIMEN_SECRET or LIMEN_TOTP_SECRET in this process's
	// environment. Both are read before the fallback to Config.Secret, so
	// either one would displace this hash as the two-factor encryption key —
	// silently, and (unless it happens to be exactly 32 bytes) fatally at the
	// first enrolment rather than at startup.
	secret := sha256.Sum256([]byte(cfg.Secret))

	// One extractor for both the session metadata and the rate limiter. It
	// resolves the address exactly as the app's own limiter does
	// (security.ClientIP, honouring TRUSTED_PROXY_HOPS) and then digests it:
	// Limen's defaults read RemoteAddr raw, which would both store an address
	// we promised not to keep and put every request behind a proxy into one
	// shared bucket.
	requestDigest := func(r *http.Request) string {
		return s.ipDigest(security.ClientIP(r.Header.Get("X-Forwarded-For"), r.RemoteAddr, cfg.TrustedProxyHops))
	}

	core := &corePlugin{}

	instance, err := limen.New(&limen.Config{
		BaseURL:  cfg.AppURL,
		Database: sqladapter.NewPostgreSQL(sqlDB),
		Secret:   secret[:],
		Schema: limen.NewDefaultSchemaConfig(
			// Without a generator Limen assumes auto-increment integer keys;
			// every id in this schema is text (00001_init.sql).
			limen.WithSchemaIDGenerator(uuidGenerator{}),
		),
		Session: limen.NewDefaultSessionConfig(
			limen.WithSessionDuration(30*24*time.Hour),
			limen.WithSessionUpdateAge(24*time.Hour),
			// REF §A8: sessions last 30 days, full stop. Limen's default
			// gives a sign-in that does not ask for "remember me" a 24-hour
			// session instead; zero switches that behaviour off so there is
			// one session lifetime and the SPA cannot shorten it by accident.
			limen.WithSessionShortDuration(0),
			limen.WithSessionIPAddressExtractor(requestDigest),
		),
		HTTP: limen.NewDefaultHTTPConfig(
			limen.WithHTTPBasePath(BasePath),
			limen.WithHTTPSessionCookieName(CookieName),
			// A self-hosted instance behind plain HTTP (or a dev machine)
			// would otherwise silently never receive a Secure cookie.
			limen.WithHTTPCookieSecure(strings.HasPrefix(cfg.AppURL, "https://")),
			// With no trusted origins Limen's origin check passes everything,
			// which makes it no check at all. The SPA is served from APP_URL
			// and nothing else calls these routes from a browser.
			limen.WithHTTPTrustedOrigins([]string{cfg.AppURL}),
			limen.WithHTTPDisabledPaths(disabledRouteIDs()),
			limen.WithHTTPRateLimiter(
				limen.WithRateLimiterKeyGenerator(requestDigest),
				// REF §A8's "everything else 60/min"; Limen's own default is
				// 100.
				limen.WithRateLimiterMaxRequests(60),
				limen.WithRateLimiterWindow(time.Minute),
				// Paths here are relative to BasePath — Limen joins them
				// before compiling the matcher.
				limen.WithRateLimiterCustomRule("/signin/credential", 5, time.Minute),
				limen.WithRateLimiterCustomRule("/passwords/request-reset", 3, 5*time.Minute),
				limen.WithRateLimiterCustomRule("/passwords/reset", 5, 5*time.Minute),
				// Covers TOTP and backup codes alike: both complete a
				// challenge through this one route.
				limen.WithRateLimiterCustomRule("/two-factor/verify", 5, time.Minute),
			),
		),
		Plugins: []limen.Plugin{
			credentialPasswordPlugin(s),
			twoFactorPlugin(cfg),
			core,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("auth: build limen: %w", err)
	}

	// Limen hands the core to every plugin's Initialize; if that never
	// happened, SignIn would nil-panic on the first invitation instead of
	// failing here, at startup, where it is obvious.
	if core.core == nil {
		return nil, errors.New("auth: limen did not initialize the core plugin")
	}

	s.limen = instance
	s.core = core.core
	s.cred = credentialpassword.Use(instance)
	s.handler = enforcePasswordMaxLength(instance.Handler())
	return s, nil
}

// credentialPasswordPlugin configures email-and-password sign-in.
//
// The composition rules Limen switches on by default (an uppercase letter, a
// digit) are switched back off: REF §A8's policy is length only, and adding
// rules here would reject passwords the Workers deployment accepted, locking
// migrated accounts out of their own password changes.
func credentialPasswordPlugin(s *service) limen.Plugin {
	return credentialpassword.New(
		credentialpassword.WithPasswordMinLength(PasswordMinLength),
		credentialpassword.WithPasswordRequireUppercase(false),
		credentialpassword.WithPasswordRequireNumbers(false),
		credentialpassword.WithPasswordRequireSymbols(false),
		// Belt and braces: the plugin defaults to signing a new account in
		// on sign-up, and the route that would do that is disabled here
		// (see disabledRouteIDs). Turning it off as well means re-enabling
		// the route later cannot quietly turn account creation into
		// authentication — signing an account in is SignIn's job, at the
		// point the setup or invitation flow decides it is safe.
		credentialpassword.WithAutoSignInOnSignUp(false),
		credentialpassword.WithSendPasswordResetEmail(s.sendPasswordResetEmail),
		credentialpassword.WithOnPasswordResetSuccess(s.onPasswordResetSuccess),
	)
}

// twoFactorPlugin configures TOTP enrolment and backup codes.
//
// No twofactor.WithSecret: the plugin falls back to Config.Secret, which is
// the 32-byte hash New computed, and that is the only value of the right
// length available. twofactor.WithSecret takes the raw string and hands it
// straight to XChaCha20-Poly1305, which requires exactly 32 bytes — passing
// AUTH_SECRET (at least 32, usually more) as REF §B1 sketches would fail at
// the first enrolment, not at startup.
//
// OTP is off because there is no channel to send a code over: Mi Casa has one
// outbound mail path and it is not a second factor.
func twoFactorPlugin(cfg Config) limen.Plugin {
	return twofactor.New(
		twofactor.WithTOTP(twofactor.WithTOTPIssuer(cfg.AppName)),
		twofactor.WithOTP(twofactor.WithOTPEnabled(false)),
		twofactor.WithBackupCodes(twofactor.WithBackupCodesCount(10)),
		// Enabling or disabling two-factor is a security-state change; the
		// sessions that existed under the old state should not survive it.
		twofactor.WithRevokeOtherSessionsOnStateChange(true),
	)
}

// knownRouteIDs is every route the registered Limen plugins can mount, as of
// the pinned versions (limen v0.2.1, credential-password v0.2.0, two-factor
// v0.2.0). It exists so the HTTP surface can be expressed as an ALLOWLIST:
// Limen registers a large, capable API by default, and every route we do not
// turn off is one we have implicitly accepted responsibility for.
//
// This list must be revisited whenever a Limen module is upgraded — a route
// added upstream and not named here would be silently enabled.
var knownRouteIDs = []string{
	// core (limen_handlers.go)
	"me", "list-sessions", "signout", "revoke-sessions",
	"verify-email", "email-verifications",
	// credential-password (handlers.go)
	"signin", "signup",
	"passwords-request-reset", "passwords-reset", "passwords-change",
	"passwords-set", "usernames-check",
	// two-factor (plugin.go, totp.go, backup_codes.go, otp.go)
	"two-factor-initiate-setup", "two-factor-finalize-setup",
	"two-factor-disable", "two-factor-verify",
	"totp-uri", "get-backup-codes", "update-backup-codes", "otp-send",
}

// allowedRouteIDs is the part of Limen's HTTP surface the SPA reaches
// (REF §B3). Everything else is turned off:
//
//   - signup: households are invite-only. A public sign-up route is the
//     difference between "the people who live here" and "anyone".
//   - passwords-set: establishes a FIRST password for an account that has
//     none, which only happens on an OAuth signup — and there is no OAuth.
//   - usernames-check: usernames are not a feature here.
//   - verify-email / email-verifications: addresses are vouched for by
//     whoever sent the invitation, not by a confirmation mail.
//   - otp-send: the plugin does not even register it with OTP disabled;
//     naming it keeps the allowlist honest if that default changes.
//   - list-sessions: GET /api/auth/sessions serialises every session Limen
//     holds for the caller INCLUDING its raw token, so one XSS or one logged
//     response body hands over live credentials for every device the account
//     owns. The device list belongs to /api/settings (REF §A2), which returns
//     the row id and the address digest and never a token.
//   - revoke-sessions: the sibling of the above, with no caller — signing
//     other devices out goes through /api/settings too, which can check what
//     it is revoking. An unauthenticated-looking POST that ends every session
//     a cookie owns is a denial-of-service primitive nothing needs.
func allowedRouteIDs() []string {
	return []string{
		"me", "signout",
		"signin",
		"passwords-request-reset", "passwords-reset", "passwords-change",
		"two-factor-initiate-setup", "two-factor-finalize-setup",
		"two-factor-disable", "two-factor-verify",
		"totp-uri", "get-backup-codes", "update-backup-codes",
	}
}

// disabledRouteIDs is the allowlist's complement. Limen matches these against
// a route's ID (or its path) and a disabled route is never registered at all,
// so requests fall through to the router's not-found handler.
func disabledRouteIDs() []string {
	allowed := make(map[string]struct{}, len(allowedRouteIDs()))
	for _, id := range allowedRouteIDs() {
		allowed[id] = struct{}{}
	}

	disabled := make([]string, 0, len(knownRouteIDs))
	for _, id := range knownRouteIDs {
		if _, ok := allowed[id]; !ok {
			disabled = append(disabled, id)
		}
	}
	return disabled
}

// Handler returns the auth router: Limen's own, behind the password-length
// guard. It is the value New built — see service.handler for why calling
// Limen's Handler() a second time would quietly weaken the rate limits.
func (s *service) Handler() http.Handler { return s.handler }

// CreateUser creates an account with a usable password.
//
// It goes through the credential plugin rather than Limen's low-level user
// create so the password is hashed and validated exactly as a sign-in will
// later expect. The display name rides along as an additional field, which is
// how a column Limen does not know about gets written.
func (s *service) CreateUser(ctx context.Context, name, email, password string) (string, error) {
	if err := validatePasswordLength(password); err != nil {
		return "", err
	}

	result, err := s.cred.SignUpWithCredentialAndPassword(ctx, &limen.User{
		Email:    limen.NormalizeEmail(email),
		Password: &password,
	}, map[string]any{"name": name})
	if err != nil {
		return "", fmt.Errorf("auth: create user: %w", err)
	}
	return idString(result.User.ID), nil
}

// SignIn mints a session for userID and writes the cookie on w.
//
// The request is needed as well as the writer: the session records the
// caller's address digest and user agent, and both come off the request that
// is completing the sign-up.
func (s *service) SignIn(ctx context.Context, w http.ResponseWriter, r *http.Request, userID string) error {
	user, err := s.core.DBAction.FindUserByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("auth: load user to sign in: %w", err)
	}

	result, err := s.core.CreateSession(ctx, r, w, &limen.AuthenticationResult{User: user})
	if err != nil {
		return fmt.Errorf("auth: create session: %w", err)
	}

	// CreateSession stores the session and builds the cookie but does not
	// write it — Limen's own handlers do that through the responder, which we
	// are not going through here.
	if err := s.core.Cookies().SetSessionCookie(w, result); err != nil {
		// A session nobody can present is worse than none: revoke it rather
		// than leave a live row the browser never learned about.
		_ = s.limen.RevokeSession(ctx, result.Token)
		return fmt.Errorf("auth: set session cookie: %w", err)
	}
	return nil
}

// RevokeAllSessions signs a user out everywhere.
func (s *service) RevokeAllSessions(ctx context.Context, userID string) error {
	if err := s.limen.RevokeAllSessions(ctx, userID); err != nil {
		return fmt.Errorf("auth: revoke sessions: %w", err)
	}
	return nil
}

// RevokeSession signs out the single session the token names.
func (s *service) RevokeSession(ctx context.Context, token string) error {
	if err := s.limen.RevokeSession(ctx, token); err != nil {
		return fmt.Errorf("auth: revoke session: %w", err)
	}
	return nil
}

// DeleteUser removes the account.
//
// Limen has no deletion API, so this is a direct statement — and it is the
// right one: every table that references a user does so ON DELETE CASCADE
// (00001_init.sql), so the sessions, the two-factor enrolment and the
// household memberships go with the row in one transaction rather than
// through a list of deletes that could stop halfway.
func (s *service) DeleteUser(ctx context.Context, userID string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM "users" WHERE "id" = $1`, userID); err != nil {
		return fmt.Errorf("auth: delete user: %w", err)
	}
	return nil
}

// IPDigest exposes the keyed digest so the app's own rate limiter keys its
// buckets the same way this one does.
func (s *service) IPDigest() func(string) string { return s.ipDigest }

// sendPasswordResetEmail is Limen's WithSendPasswordResetEmail callback.
//
// Limen hands over only the address and the token (REF §B6.4): the link is
// ours to build, because only this application knows where its reset screen
// lives, and the greeting name is looked up here because the callback carries
// no user. The signature has no context and no error return, so the lookup
// gets a deadline of its own and a failure to greet somebody by name must not
// stop the mail — an unnamed reset link still works.
func (s *service) sendPasswordResetEmail(email, token string) {
	if s.sendReset == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var name string
	if user, err := s.core.DBAction.FindUserByEmail(ctx, email); err == nil {
		name = rawString(user.Raw(), "name")
	}

	link := fmt.Sprintf("%s/reset-password?token=%s", s.appURL, url.QueryEscape(token))
	// The error is dropped on purpose: Limen ignores the callback's outcome
	// and the route answers 200 either way, so that a caller cannot learn
	// which addresses have accounts by watching for failures. Delivery
	// problems are the mailer's to log.
	_ = s.sendReset(ctx, email, name, link)
}

// onPasswordResetSuccess ends every other session the moment a password
// changes (REF §A8). A reset is either a recovery or a response to a
// compromise, and both want the old sessions gone.
// The error is dropped because Limen's hook returns nothing and the reset has
// already committed by the time it runs; a failure here leaves the old
// sessions alive, which the session store's own expiry eventually clears.
func (s *service) onPasswordResetSuccess(ctx context.Context, user *limen.User) {
	if user == nil {
		return
	}
	_ = s.limen.RevokeAllSessions(ctx, user.ID)
}

// validatePasswordLength enforces both ends of REF §A8's policy before a
// password is hashed. Limen would reject a short one itself; doing it here as
// well means CreateUser fails with our own error rather than a plugin's, and
// it is the only place the maximum is checked at all.
func validatePasswordLength(password string) error {
	if len(password) < PasswordMinLength || len(password) > PasswordMaxLength {
		return ErrPasswordLength
	}
	return nil
}

// uuidGenerator supplies the text primary keys our schema declares. Limen
// would otherwise assume auto-increment integers and hand the database an
// int64 for a text column.
type uuidGenerator struct{}

func (uuidGenerator) Generate(context.Context) (any, error) {
	return uuid.NewString(), nil
}

func (uuidGenerator) GetColumnType() limen.ColumnType { return limen.ColumnTypeString }

// idString normalizes Limen's `any`-typed identifiers. With our generator
// they are always strings; the fallback keeps a surprise from becoming a
// panic.
func idString(id any) string {
	if s, ok := id.(string); ok {
		return s
	}
	if id == nil {
		return ""
	}
	return fmt.Sprintf("%v", id)
}
