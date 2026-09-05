package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
)

// This file is api.go's route table: which guard chain each operation runs
// behind, and which of them carry a rate limit. It is separate from api.go so
// NewHandler stays readable as the shape of the surface while these two maps
// grow one line per route task.
//
// Both concerns are wired at the SAME generated-code layer — a
// gen.StrictMiddlewareFunc, the only layer that is told which operationID it
// is wrapping. That is what makes a per-route policy expressible at all: the
// http.Handler layer above knows only a path, and the strict handler below
// knows only its own body.

// authTier is what a route requires of its caller. The four tiers are REF
// §A1's guards, plus tierViewer for the two routes that want to KNOW who is
// calling without requiring anybody (REF §A1 item 6 mounts loadAuthSession
// "inside /api/invitations", which is exactly that).
type authTier int

const (
	// tierPublic runs no auth middleware at all. The probes and both setup
	// routes: first-run setup happens before any account exists, so requiring
	// one is impossible by construction.
	tierPublic authTier = iota

	// tierViewer resolves the caller and requires nothing. The invitation
	// routes: an invitee may be signed out (create the account), signed in as
	// the invited address (accept as themselves), or signed in as somebody
	// else (which is a 403 the HANDLER writes, because it needs to say which
	// of the three happened).
	tierViewer

	// tierSession requires a caller and nothing else.
	tierSession

	// tierHousehold requires a caller who is a member of the {slug} in the
	// path. Note that RequireHousehold reads r.PathValue("slug"), which only
	// works because the generated mux registers Go 1.22 patterns with the
	// same {slug} wildcard the spec spells.
	tierHousehold

	// tierOwner is tierHousehold plus the owner role.
	tierOwner
)

// operationAuthTiers maps every generated operationID (which is the
// gen.StrictServerInterface method name) to the tier it runs behind.
// assertOperationAuthCoverage keeps this exhaustive and exact against the
// embedded spec, so a route task that forgets an entry fails at boot rather
// than shipping an unguarded endpoint.
var operationAuthTiers = map[string]authTier{
	// The probes sit outside /api/ entirely and answer no question about
	// anybody's data.
	"Healthz": tierPublic,
	"Readyz":  tierPublic,

	// Setup (REF §A2, "Setup — public"). Both are reachable signed out by
	// necessity; POST /api/setup/complete is guarded instead by SETUP_SECRET,
	// the OWNER_EMAIL match, the single-claim state machine and a rate limit.
	"GetSetupStatus": tierPublic,
	"CompleteSetup":  tierPublic,

	// Invitations (REF §A2, "Invitations — public"). See tierViewer.
	"LookupInvitation": tierViewer,
	"AcceptInvitation": tierViewer,

	// Households (REF §A2, "Households — session required"). Only the leave
	// route names a household in its path, and it is the one that needs the
	// tenancy guard; the other two answer about the caller themselves, so
	// their tenancy is the session.
	"ListMyHouseholds": tierSession,
	"CreateHousehold":  tierSession,
	"LeaveHousehold":   tierHousehold,

	// Settings (REF §A2, "Settings — session required"). Every one of these is
	// about the caller's own account — there is no user id in any path — so
	// the session is both the authentication and the subject.
	"GetAccountSettings":     tierSession,
	"ListSettingsHouseholds": tierSession,
	"UpdateProfile":          tierSession,
	"RevokeOtherSessions":    tierSession,
	"RevokeSession":          tierSession,
}

// operationRateLimits maps an operationID to the rule its route is limited by.
// Absence means no limit — the ordinary case — so this map names only the
// endpoints that carry a secret (REF §A1, "Rate limiting").
var operationRateLimits = map[string]ratelimit.Rule{
	"CompleteSetup":    ratelimit.Setup,
	"LookupInvitation": ratelimit.Invitations,
	"AcceptInvitation": ratelimit.Invitations,

	// Household creation carries no secret, but each one claims an inbound
	// email address, so the budget (10 per hour) is what keeps a signed-in
	// caller from minting them faster than a person plausibly would.
	"CreateHousehold": ratelimit.HouseholdCreate,
}

// publicAPIAllowlist is the exhaustive set of tierPublic operations allowed to
// live under /api/ — as opposed to the probes, which are tierPublic too but
// sit outside /api/ entirely. "No auth chain at all" is a much louder claim
// for a route nested under /api/ than for a liveness probe, so a future
// mistyped tier (meant tierViewer, typed tierPublic) is caught at boot instead
// of shipping an unauthenticated domain route.
//
// Both entries are the first-run flow, which by definition runs before any
// account exists. Read why these two need it before adding a third.
var publicAPIAllowlist = map[string]bool{
	"GetSetupStatus": true,
	"CompleteSetup":  true,
}

// assertOperationAuthCoverage panics unless operationAuthTiers has exactly one
// entry per operationId in spec — no fewer (a route task that forgot to
// classify its operation) and no more (a stale entry left by a rename). Called
// once, at NewHandler build time: a wiring mistake should stop the process,
// not wait to be noticed as an endpoint anybody can call.
func assertOperationAuthCoverage(spec *openapi3.T) {
	seen := make(map[string]bool, len(operationAuthTiers))
	for _, path := range spec.Paths.InMatchingOrder() {
		item := spec.Paths.Find(path)
		for method, op := range item.Operations() {
			if op.OperationID == "" {
				panic(fmt.Sprintf("api: %s %s has no operationId", method, path))
			}
			// The generated method name is the operationId with an
			// upper-cased first letter, which is how oapi-codegen exports it.
			name := strings.ToUpper(op.OperationID[:1]) + op.OperationID[1:]
			tier, ok := operationAuthTiers[name]
			if !ok {
				panic(fmt.Sprintf(
					"api: operation %q (%s %s) has no entry in operationAuthTiers — add one (see routes.go)",
					name, method, path))
			}
			if tier == tierPublic && strings.HasPrefix(path, "/api/") && !publicAPIAllowlist[name] {
				panic(fmt.Sprintf(
					"api: operation %q (%s %s) is tierPublic under /api/ but missing from publicAPIAllowlist — "+
						"either that is a mistake (this route needs a real tier) or it is deliberate and belongs in the allowlist",
					name, method, path))
			}
			seen[name] = true
		}
	}
	for name := range operationAuthTiers {
		if !seen[name] {
			panic(fmt.Sprintf("api: operationAuthTiers has a stale entry %q with no matching spec operation", name))
		}
	}
	for name := range operationRateLimits {
		if !seen[name] {
			panic(fmt.Sprintf("api: operationRateLimits has a stale entry %q with no matching spec operation", name))
		}
	}
}

// authChain is the gen.StrictMiddlewareFunc that applies operationAuthTiers:
// it looks the operationID up and wraps the call in the matching
// middleware.Session/RequireSession/RequireHousehold/RequireOwner chain.
//
// The ordinary http.Handler middlewares are reused rather than reimplemented
// at the strict layer (see adaptMiddleware): they are unit-tested on their own
// in internal/api/middleware, and a second implementation of an authorization
// check is a second thing that can be wrong.
func authChain(d Deps) gen.StrictMiddlewareFunc {
	mwDeps := middleware.Deps{
		Auth:             d.Auth,
		Repo:             d.Repo,
		RateLimit:        d.RateLimit,
		AppURL:           d.AppURL,
		TrustedProxyHops: d.TrustedProxyHops,
		IPDigest:         d.IPDigest,
		Now:              d.Now,
	}
	session := middleware.Session(mwDeps)
	requireSession := middleware.RequireSession()
	household := middleware.RequireHousehold(mwDeps)
	owner := middleware.RequireOwner()
	// Mounted on every tier: an operation that writes a session cookie can
	// appear in any of them (setup is tierPublic, invitation accept is
	// tierViewer), and the middleware costs one context value.
	captureHTTP := middleware.CaptureHTTP()

	return func(f gen.StrictHandlerFunc, operationID string) gen.StrictHandlerFunc {
		tier, ok := operationAuthTiers[operationID]
		if !ok {
			// assertOperationAuthCoverage already panicked at build time if
			// this were reachable; kept as a loud fallback rather than
			// silently letting the request through unguarded.
			panic("api: no authTier for operation " + operationID)
		}

		var chain func(http.Handler) http.Handler
		switch tier {
		case tierPublic:
			chain = captureHTTP
		case tierViewer:
			chain = func(h http.Handler) http.Handler { return session(captureHTTP(h)) }
		case tierSession:
			chain = func(h http.Handler) http.Handler { return session(requireSession(captureHTTP(h))) }
		case tierHousehold:
			chain = func(h http.Handler) http.Handler { return session(household(captureHTTP(h))) }
		case tierOwner:
			chain = func(h http.Handler) http.Handler { return session(household(owner(captureHTTP(h)))) }
		default:
			panic(fmt.Sprintf("api: unknown authTier %d for operation %q", tier, operationID))
		}
		return adaptMiddleware(chain)(f, operationID)
	}
}

// rateLimitChain is the second gen.StrictMiddlewareFunc: it applies
// operationRateLimits and leaves every other operation untouched.
//
// It is listed BEFORE authChain in NewHandler's slice, which — per the
// generated dispatcher's fold, where the last entry ends up outermost — puts
// the limiter INSIDE the auth chain. That is the TypeScript's order for the
// invitation routes (`use("*", loadAuthSession)` then `use("*",
// rateLimit(...))`) and it also means the limiter buckets by the client key
// Session already derived, rather than deriving its own.
//
// One divergence from that predecessor, deliberate: this layer runs only for
// requests that got past withSpecValidation, so a malformed setup body is
// rejected without being charged against the setup quota. A request that never
// reaches the handler has no value against what the limit is for — slowing a
// SETUP_SECRET or invitation-token guess — since neither secret is even read.
func rateLimitChain(d Deps) gen.StrictMiddlewareFunc {
	mwDeps := middleware.Deps{
		RateLimit:        d.RateLimit,
		TrustedProxyHops: d.TrustedProxyHops,
		IPDigest:         d.IPDigest,
		Now:              d.Now,
	}

	limiters := make(map[string]func(http.Handler) http.Handler, len(operationRateLimits))
	for operationID, rule := range operationRateLimits {
		limiters[operationID] = middleware.RateLimit(mwDeps, rule)
	}

	return func(f gen.StrictHandlerFunc, operationID string) gen.StrictHandlerFunc {
		limiter, ok := limiters[operationID]
		if !ok {
			return f
		}
		return adaptMiddleware(limiter)(f, operationID)
	}
}

// adaptMiddleware lifts an ordinary http.Handler middleware into a
// gen.StrictMiddlewareFunc, so package middleware's independently tested
// chain gates generated operations too.
//
// The terminal handler captures f's result into resp/err by closure. When mw
// REJECTS the request — writes to w and does not call next, which is how every
// middleware in this chain reports a refusal — resp and err are left at their
// zero values, and the generated dispatcher's "response != nil" check treats
// that as "nothing more to write". A rejected request is therefore never
// written twice.
//
// r is deliberately the request the middleware passes on (req, not the
// captured r): that is the one carrying whatever the middleware put in its
// context — the session, the household, the ResponseWriter.
func adaptMiddleware(mw func(http.Handler) http.Handler) gen.StrictMiddlewareFunc {
	return func(f gen.StrictHandlerFunc, _ string) gen.StrictHandlerFunc {
		return func(_ context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
			var resp any
			var err error
			terminal := http.HandlerFunc(func(_ http.ResponseWriter, req *http.Request) {
				resp, err = f(req.Context(), w, req, request)
			})
			mw(terminal).ServeHTTP(w, r)
			return resp, err
		}
	}
}
