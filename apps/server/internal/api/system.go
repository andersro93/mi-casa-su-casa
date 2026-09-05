package api

import (
	"net/http"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
)

// retentionStaleAfter is how long readiness tolerates silence from the
// retention job before calling it stale (REF §A2). The job runs daily, so
// 48 hours is one missed run plus a full day of slack — long enough that a
// restart or a slow night never trips it, short enough that a job which has
// been failing for a week is visible on the readiness endpoint rather than
// only in logs nobody reads.
const retentionStaleAfter = 48 * time.Hour

// readyBody is /readyz's success shape (REF §A2). Field names are
// camelCase because the SPA and the deployment's own probes read them.
type readyBody struct {
	Ok              bool            `json:"ok"`
	Status          string          `json:"status"`
	SetupConfigured bool            `json:"setupConfigured"`
	Retention       retentionStatus `json:"retention"`
}

// retentionStatus reports the retention job's last success. LastRunAt is a
// pointer so "never run" serialises as null rather than as a zero time,
// which would read as 1 January year 1 and be silently treated as stale by
// anything comparing timestamps instead of reading Stale.
type retentionStatus struct {
	LastRunAt *string `json:"lastRunAt"`
	Stale     bool    `json:"stale"`
}

// notReadyBody is /readyz's failure shape: `ok` is present and false so a
// probe that only parses one field still gets the right answer.
type notReadyBody struct {
	Ok    bool   `json:"ok"`
	Error string `json:"error"`
}

// handleHealthz is a pure liveness probe: it touches nothing, not even the
// database pool, so a Postgres outage never turns "the process is up" into
// a false negative and a restart loop. Deps.Pool is deliberately unread
// here (REF §A2), and the tests prove it by passing a nil one.
func (d Deps) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	respond.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleReadyz answers "should this instance receive traffic?". It reads
// the installation singleton, which does double duty: the round trip proves
// the database is reachable, and the row carries the retention job's last
// success — so one query answers both halves of REF §A2's payload.
//
// A failed query is a 503 with the reason in the body, never a 500: a
// database outage is a normal, expected state for a booting or draining
// instance, and the orchestrator's response to it (route elsewhere) is the
// same either way.
//
// setupConfigured is unconditionally true. Its TypeScript predecessor
// reported whether OWNER_EMAIL and SETUP_SECRET were set; internal/config
// requires both at boot, so a running process cannot be missing them. The
// field stays in the payload because the SPA reads it.
func (d Deps) handleReadyz(w http.ResponseWriter, r *http.Request) {
	installation, err := d.Q.GetInstallation(r.Context())
	if err != nil {
		respond.JSON(w, http.StatusServiceUnavailable, notReadyBody{Ok: false, Error: err.Error()})
		return
	}

	retention := retentionStatus{Stale: true}
	if installation.LastRetentionRunAt.Valid {
		ranAt := installation.LastRetentionRunAt.Time
		formatted := ranAt.UTC().Format(time.RFC3339)
		retention.LastRunAt = &formatted
		retention.Stale = d.Now().Sub(ranAt) > retentionStaleAfter
	}

	respond.JSON(w, http.StatusOK, readyBody{
		Ok:              true,
		Status:          "ready",
		SetupConfigured: true,
		Retention:       retention,
	})
}
