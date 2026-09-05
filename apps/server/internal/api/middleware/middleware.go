// Package middleware is the chain every /api/* request passes through
// before it reaches a route: who is calling (Session, RequireSession),
// which household they are acting on (RequireHousehold, RequireOwner),
// whether the request is same-site (SameSite), how often they may ask
// (RateLimit) and what to say in the log when it fails (LogFailures).
//
// Ported from the Hono middleware the Workers deployment composed in
// src/index.ts (REF §A1): src/server/auth/middleware.ts for the guards,
// src/server/security/origin.ts for the same-site policy,
// src/server/security/rate-limit.ts for the brake and
// src/server/runtime/log.ts for the failure log.
//
// Two conventions hold throughout:
//
//   - Each middleware either answers the request itself or calls next; none
//     of them changes a response another handler has written. The refusals
//     they write are all the same envelope (internal/api/respond) with the
//     exact strings the SPA branches on.
//
//   - What one middleware resolves, the next reads from the request context
//     through an accessor (UserFrom, HouseholdFrom, ClientKey) rather than
//     resolving again. The session in particular costs a database round trip
//     and is looked up exactly once per request.
//
// Task 12 assembles these into the actual chain; this package only defines
// them.
package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/security"
)

// Deps is what the middlewares need from the composition root. It is a
// separate struct from api.Deps (which embeds the same collaborators)
// because this package must not import internal/api: internal/api builds
// its handler out of these middlewares, and the dependency has to run one
// way.
type Deps struct {
	// Auth resolves the session cookie. Session is the only caller.
	Auth auth.Service

	// Repo answers the tenancy question RequireHousehold asks.
	Repo *repo.Repo

	// RateLimit holds the counters. Nil is a programming error at the one
	// place RateLimit is mounted, not a per-request condition, so it is not
	// defended against here.
	RateLimit ratelimit.Store

	// AppURL is the origin the SPA is served from — the only origin
	// SameSite accepts (plus localhost in development).
	AppURL string

	// TrustedProxyHops says how many proxies sit in front of this process,
	// and therefore how much of X-Forwarded-For may be believed. See
	// security.ClientIP.
	TrustedProxyHops int

	// IPDigest turns a client address into the opaque value rate-limit keys
	// are built from. The address itself never leaves this package.
	IPDigest func(string) string

	// Now is the clock, so a test can pin which rate-limit window a request
	// falls into. Nil means time.Now.
	Now func() time.Time
}

// now reads the injected clock, defaulting to the real one so a Deps built
// without it still works.
func (d Deps) now() time.Time {
	if d.Now == nil {
		return time.Now()
	}
	return d.Now()
}

// contextKey keeps this package's context values from colliding with any
// other package's, which is why it is an unexported named type rather than
// a string.
type contextKey int

const (
	userKey contextKey = iota
	householdKey
	clientKeyKey
	requestIDKey
)

// Session resolves the caller once and puts them in the request context.
// Ported from loadAuthSession. It is a loader, not a guard: an anonymous
// request passes through with a nil user, because several routes
// (invitation lookup, setup) are reachable signed out and want to know who
// the caller is anyway.
//
// It also derives the opaque client key here, so everything downstream —
// the rate limiter above all — shares one answer to "where is this request
// from" rather than each recomputing it.
//
// A failure to resolve the session is NOT rendered as "signed out". A
// database outage would otherwise sign every user out at once and lose
// whatever they had not saved; it is a 500, and the caller's browser keeps
// its cookie.
func Session(d Deps) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, err := d.Auth.SessionFromRequest(r)
			if err != nil {
				internalError(w, r, "session lookup", err)
				return
			}

			ctx := context.WithValue(r.Context(), userKey, session)
			ctx = context.WithValue(ctx, clientKeyKey, d.clientKey(r))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireSession refuses anonymous callers. Ported from
// requireAuthenticatedUser; mount it behind Session.
func RequireSession() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if UserFrom(r) == nil {
				respond.Error(w, http.StatusUnauthorized, "Unauthorized")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserFrom is the caller Session resolved, or nil when nobody is signed in
// (or when Session did not run).
func UserFrom(r *http.Request) *auth.Session {
	session, _ := r.Context().Value(userKey).(*auth.Session)
	return session
}

// ClientKey is the opaque, digested client identity for this request: the
// value rate-limit buckets are keyed by. Empty when nothing upstream
// derived one.
//
// It is a digest, never an address. A rate-limit row outlives the request
// that created it, so storing the address would turn a database dump into a
// record of who visited which household.
func ClientKey(r *http.Request) string {
	key, _ := r.Context().Value(clientKeyKey).(string)
	return key
}

// clientKey derives the value ClientKey returns: the trusted client address
// (security.ClientIP), run through the keyed digest.
func (d Deps) clientKey(r *http.Request) string {
	address := security.ClientIP(r.Header.Get("X-Forwarded-For"), r.RemoteAddr, d.TrustedProxyHops)
	if d.IPDigest == nil {
		// Without a digest function there is nothing safe to key on, and
		// bucketing every caller together is a safer failure than storing
		// addresses in the clear.
		return "undigested"
	}
	return d.IPDigest(address)
}

// internalError is the answer to "a collaborator failed for a reason that is
// not the caller's fault": the same 500 the TypeScript error handler wrote
// (REF §A1 item 11), plus the `unhandled_error` line from the catalogue.
//
// The error's text goes to the log and never to the response: a pgx error
// carries the failing statement, which is useful to an operator reading the
// log and is not something to hand a caller.
func internalError(w http.ResponseWriter, r *http.Request, during string, err error) {
	fields := map[string]any{
		"during": during,
		"method": r.Method,
		"path":   r.URL.Path,
		"error":  err.Error(),
	}
	if id := requestIDFrom(r); id != "" {
		fields["requestId"] = id
	}
	applog.Event(applog.LevelError, "unhandled_error", fields)
	respond.Error(w, http.StatusInternalServerError, "Internal error")
}
