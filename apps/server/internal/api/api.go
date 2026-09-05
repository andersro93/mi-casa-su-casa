// Package api is the HTTP surface's composition point: it turns Deps — the
// collaborators the composition root in apps/server/cmd/mi-casa assembles —
// into the handler that answers /api/* plus the two top-level health
// probes.
//
// package web wraps whatever NewHandler returns with static asset serving
// and REF §A1's security headers; api.NewHandler itself is only ever
// reached for /api/* requests and for /healthz and /readyz (see
// web.Handler's routing).
//
// # The spec is the routing table
//
// openapi/mi-casa.yaml (embedded here as mi-casa.yaml, see generate.go) is
// the single source of truth for this surface. Every route is one operation
// in that file: `go generate` turns it into internal/api/gen's
// StrictServerInterface — one method per operationId, taking and returning
// typed request/response structs — and into the mux registrations that call
// them. A route task therefore starts in the spec, runs `go generate`, and
// then implements the new interface method on server (see system.go for the
// pattern); spec_sync_test.go fails if the committed generated code or the
// embedded copy has drifted from it.
//
// The same spec is checked at runtime: withSpecValidation wraps the whole
// mux, so a request that does not match an operation never reaches a
// handler. That is also where /api/*'s JSON 404 comes from — a path the
// spec does not describe does not exist.
package api

import (
	_ "embed"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	dbgen "github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Deps is every collaborator the API layer needs, assembled by the
// composition root and never constructed by this package itself: no file
// below this one reads os.Getenv or opens a connection, which is what makes
// the handlers testable against a real database and a pinned clock.
//
// Later tasks add fields (the outbound mailer, the scheduler's clock); the
// shape below is what the health probes, the middleware chain and the
// container's boot need today.
type Deps struct {
	Pool *pgxpool.Pool
	Q    *dbgen.Queries

	// Auth, Repo and RateLimit are the collaborators the middleware chain
	// is built from (internal/api/middleware.Deps). They live here rather
	// than being constructed in NewHandler because the composition root is
	// the only place allowed to open a connection or read a secret.
	Auth      auth.Service
	Repo      *repo.Repo
	RateLimit ratelimit.Store

	// Mail delivers outbound messages (internal/mail). Password resets reach
	// it through the hook the composition root gives auth.New; invitations
	// call it directly.
	Mail mail.Sender

	// IPDigest turns a client address into the opaque value rate-limit keys
	// are built from — auth.Service.IPDigest, so the app's own limiter
	// buckets a caller exactly as Limen's does.
	IPDigest func(string) string

	// DevMode is ENVIRONMENT=development, and only that: it widens the
	// same-site policy to accept a local Vite dev server on another port.
	// "test" is deliberately excluded (see middleware.SameSite).
	DevMode bool

	// Now is the clock every handler reads instead of calling time.Now
	// directly, so tests can pin both sides of a comparison — readiness'
	// 48-hour retention window being the first of them.
	Now func() time.Time

	AppURL           string
	AppName          string
	EmailDomain      string
	TrustedProxyHops int

	// SetupSecret and OwnerEmail are the two halves of the first-run gate
	// (REF §A2, "Setup"): the secret the claim must present, compared in
	// constant time, and the one address allowed to become the owner. Both
	// are required by internal/config, which is why the TypeScript's 503
	// "setup is unavailable until they are configured" has no counterpart
	// here — a process without them does not boot.
	SetupSecret string
	OwnerEmail  string
}

// server implements gen.StrictServerInterface — one method per operation in
// the spec, each in the file that owns that part of the surface (system.go
// for the probes). It is Deps plus nothing: the embedding keeps handlers
// reading d.Q, d.Now and the rest directly, while giving the generated
// interface a receiver that is not the dependency struct itself.
type server struct {
	Deps
}

// specYAML is a committed copy of the repo-root openapi/mi-casa.yaml (see
// generate.go for why a copy is needed: go:embed cannot reach outside this
// module's own directory tree). It backs the request-validation middleware.
//
//go:embed mi-casa.yaml
var specYAML []byte

// loadSpec parses and validates the embedded spec. Called once per
// NewHandler call; a failure here means the committed spec is broken, which
// should never survive `go generate` plus review — panicking makes that loud
// at boot rather than silently serving an unvalidated API.
func loadSpec() *openapi3.T {
	loader := openapi3.NewLoader()
	spec, err := loader.LoadFromData(specYAML)
	if err != nil {
		panic(fmt.Sprintf("api: parse embedded spec: %v", err))
	}
	if err := spec.Validate(loader.Context); err != nil {
		panic(fmt.Sprintf("api: embedded spec is invalid: %v", err))
	}
	return spec
}

// NewHandler builds the API handler: Limen's router at /api/auth/, every
// operation in the spec mounted where the spec puts it (the two probes at
// their top-level paths, where the TypeScript app served them and where the
// container's own healthcheck looks; everything else under /api/), and
// REF §A1's cross-cutting layers around the lot.
//
// Outermost first, which is the order a request meets them:
//
//	LogFailures        one line per response with a status ≥ 400
//	X-Content-Type-Options: nosniff
//	SameSite           except /api/auth/, which does its own origin check
//	spec validation    except /api/auth/; also the source of the JSON 404
//	per-operation      rate limit, then the auth tier (see routes.go)
func NewHandler(d Deps) http.Handler {
	spec := loadSpec()
	assertOperationAuthCoverage(spec)

	mux := http.NewServeMux()

	// Limen's own router, mounted directly: it owns its request shapes (so
	// spec validation would only reject them) and its own origin check (so
	// SameSite below would be a second, differently-spelled one). Both
	// exclusions are honoured by the wrappers, not by this line — see
	// skipSpecValidation and exceptPrefix.
	//
	// The nil check is for the probe-only Deps a unit test builds (see
	// system_test.go, which passes a nil pool to prove liveness touches
	// nothing). It is not a production path: cmd/mi-casa's buildDeps fails
	// rather than returning a Deps without an auth service, and every route
	// above tierPublic resolves a session through it, so a real handler
	// without one could not answer anything but the probes anyway.
	if d.Auth != nil {
		mux.Handle(auth.BasePath+"/", d.Auth.Handler())
	}

	// Every operation in the spec, wrapped at the two generated-code layers
	// (see routes.go): the http.Handler layer gets the JSON charset fixup,
	// and the strict layer — the only one told which operation it is —
	// gets the rate limits and the auth tiers. The last entry in a
	// StrictMiddlewareFunc slice ends up outermost, so listing the limiter
	// first puts it inside the auth chain.
	strict := gen.NewStrictHandlerWithOptions(
		server{d},
		[]gen.StrictMiddlewareFunc{rateLimitChain(d), authChain(d)},
		gen.StrictHTTPServerOptions{
			RequestErrorHandlerFunc:  requestErrorHandler,
			ResponseErrorHandlerFunc: responseErrorHandler,
		},
	)
	gen.HandlerWithOptions(strict, gen.StdHTTPServerOptions{
		BaseRouter:  mux,
		Middlewares: []gen.MiddlewareFunc{withJSONCharset},
	})

	// REF §A1's order, outermost first: the failure log wraps everything so
	// it sees the status any layer below wrote; nosniff is a header on every
	// answer this handler gives; the same-site guard refuses a forged
	// mutation before validation or a handler runs.
	handler := withSpecValidation(spec, mux)
	handler = exceptPrefix(auth.BasePath+"/", middleware.SameSite(d.AppURL, d.DevMode))(handler)
	handler = withNoSniff(handler)
	handler = middleware.LogFailures()(handler)
	return handler
}

// withNoSniff sets X-Content-Type-Options on every response this handler
// writes (REF §A1 item 1). package web sets the full header set on the SPA and
// its assets but deliberately adds nothing to /api/*, so the one header that
// matters for a JSON API — the browser must not sniff a response body into
// some other content type — is set here instead.
//
// It is set before the wrapped handler runs rather than after: by the time a
// handler has written its status the header map is already on the wire.
func withNoSniff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// exceptPrefix applies mw to every request except those under prefix. It
// exists for one exclusion — Limen's routes, which do their own origin check
// (auth.New's WithHTTPTrustedOrigins) — and is written as a helper so that
// exclusion is one readable line at the mount point rather than a path test
// buried inside the middleware it excludes.
func exceptPrefix(prefix string, mw func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		wrapped := mw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, prefix) {
				next.ServeHTTP(w, r)
				return
			}
			wrapped.ServeHTTP(w, r)
		})
	}
}

// requestErrorHandler answers the one failure the generated dispatcher can
// hit before a handler runs: a body that is not the JSON its Content-Type
// claims. Spec validation has already rejected almost every such body with a
// better message, so this is the backstop — and it must exist, because
// oapi-codegen's default writes the raw Go error as text/plain.
func requestErrorHandler(w http.ResponseWriter, _ *http.Request, _ error) {
	respond.Error(w, http.StatusBadRequest, "Invalid JSON body")
}

// responseErrorHandler answers a handler that returned an error rather than a
// response object: an unexpected failure, which REF §A1 item 11 answers with
// `unhandled_error` in the log and a 500 that says nothing else. The error
// text stays in the log — a pgx error names the statement that failed, which
// is for the operator and not for the caller.
func responseErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	applog.Event(applog.LevelError, "unhandled_error", map[string]any{
		"method": r.Method,
		"path":   r.URL.Path,
		"error":  err.Error(),
	})
	respond.Error(w, http.StatusInternalServerError, "Internal error")
}
