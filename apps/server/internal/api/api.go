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
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	dbgen "github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
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

// NewHandler builds the API handler: every operation in the spec, mounted
// where the spec puts it — today the two probes at their top-level paths
// (where the TypeScript app served them, and where the container's own
// healthcheck looks) — behind request validation, which also answers for
// the paths and methods the spec does not know.
func NewHandler(d Deps) http.Handler {
	mux := http.NewServeMux()

	gen.HandlerWithOptions(gen.NewStrictHandler(server{d}, nil), gen.StdHTTPServerOptions{
		BaseRouter:  mux,
		Middlewares: []gen.MiddlewareFunc{withJSONCharset},
	})

	return withSpecValidation(loadSpec(), mux)
}
