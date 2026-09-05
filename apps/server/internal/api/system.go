package api

import (
	"context"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
)

// server answers every operation in the spec; this file owns the system
// ones. The assertion is here, once, so adding an operation to the spec
// fails the build until a handler for it exists somewhere in the package.
var _ gen.StrictServerInterface = server{}

// retentionStaleAfter is how long readiness tolerates silence from the
// retention job before calling it stale (REF §A2). The job runs daily, so
// 48 hours is one missed run plus a full day of slack — long enough that a
// restart or a slow night never trips it, short enough that a job which has
// been failing for a week is visible on the readiness endpoint rather than
// only in logs nobody reads.
const retentionStaleAfter = 48 * time.Hour

// Healthz is a pure liveness probe: it touches nothing, not even the
// database pool, so a Postgres outage never turns "the process is up" into
// a false negative and a restart loop. Deps.Pool is deliberately unread
// here (REF §A2), and the tests prove it by passing a nil one.
func (s server) Healthz(context.Context, gen.HealthzRequestObject) (gen.HealthzResponseObject, error) {
	return gen.Healthz200JSONResponse{Ok: gen.Healthz200JSONResponseBodyOkTrue}, nil
}

// Readyz answers "should this instance receive traffic?". It reads the
// installation singleton, which does double duty: the round trip proves the
// database is reachable, and the row carries the retention job's last
// success — so one query answers both halves of REF §A2's payload.
//
// A failed query is a 503 with the reason in the body, never a 500: a
// database outage is a normal, expected state for a booting or draining
// instance, and the orchestrator's response to it (route elsewhere) is the
// same either way. It is returned as a response rather than as an error for
// the same reason — nothing here is unexpected.
//
// setupConfigured is unconditionally true. Its TypeScript predecessor
// reported whether OWNER_EMAIL and SETUP_SECRET were set; internal/config
// requires both at boot, so a running process cannot be missing them. The
// field stays in the payload because the SPA reads it.
func (s server) Readyz(ctx context.Context, _ gen.ReadyzRequestObject) (gen.ReadyzResponseObject, error) {
	installation, err := s.Q.GetInstallation(ctx)
	if err != nil {
		return gen.Readyz503JSONResponse{Ok: gen.False, Error: err.Error()}, nil
	}

	body := gen.Readyz200JSONResponse{
		Ok:              gen.Readyz200JSONResponseBodyOkTrue,
		Status:          "ready",
		SetupConfigured: true,
	}
	// Stale until proven otherwise: a database that has never recorded a
	// run is a fresh install, which is exactly the state the field warns
	// about, and lastRunAt stays null rather than becoming a zero time that
	// reads as 1 January year 1.
	body.Retention.Stale = true
	if installation.LastRetentionRunAt.Valid {
		ranAt := installation.LastRetentionRunAt.Time.UTC()
		body.Retention.LastRunAt = &ranAt
		body.Retention.Stale = s.Now().Sub(ranAt) > retentionStaleAfter
	}
	return body, nil
}
