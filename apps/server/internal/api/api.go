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
// The mux here is a plain net/http one on purpose. The real route tree is
// generated from the OpenAPI spec in a later task; until then this package
// carries only what the container needs to boot and be probed, and the
// catch-all 404 keeps every unimplemented /api/ path answering JSON rather
// than falling through to the SPA.
package api

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
)

// Deps is every collaborator the API layer needs, assembled by the
// composition root and never constructed by this package itself: no file
// below this one reads os.Getenv or opens a connection, which is what makes
// the handlers testable against a real database and a pinned clock.
//
// Later tasks add fields (the auth service, the rate-limit store, the
// outbound mailer); the shape below is what the health probes and the
// container's boot need today.
type Deps struct {
	Pool *pgxpool.Pool
	Q    *gen.Queries

	// Now is the clock every handler reads instead of calling time.Now
	// directly, so tests can pin both sides of a comparison — readiness'
	// 48-hour retention window being the first of them.
	Now func() time.Time

	AppURL           string
	AppName          string
	EmailDomain      string
	TrustedProxyHops int
}

// NewHandler builds the API handler: the two probes at their top-level
// paths (where the TypeScript app mounted them, and where the container's
// own healthcheck looks), and a JSON 404 for everything else under /api/.
func NewHandler(d Deps) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", d.handleHealthz)
	mux.HandleFunc("GET /readyz", d.handleReadyz)

	// Least-specific pattern: net/http's ServeMux dispatches by pattern
	// specificity rather than registration order, so this catches every
	// /api/ request no route above has claimed. An XHR that gets index.html
	// back instead fails with a JSON parse error three layers away from the
	// actual mistake.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		respond.Error(w, http.StatusNotFound, "Not found")
	})

	return mux
}
