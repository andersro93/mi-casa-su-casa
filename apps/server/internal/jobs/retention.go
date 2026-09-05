// Package jobs holds the work the scheduler runs, one exported function per
// job, and nothing about WHEN it runs — that belongs to internal/cron, and
// the exit code a CLI invocation turns it into belongs to cmd/mi-casa. The
// split is what lets `mi-casa cron retention` and the in-process scheduler
// share one implementation instead of two that drift.
//
// It is the Go port of src/server/jobs/retention.ts.
package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Deps is everything the scheduled work needs, handed in by cmd/mi-casa's
// composition root exactly as it hands api.Deps to the HTTP layer. Nothing
// here reads the environment or opens a connection.
//
// Q sits beside Repo because two of the job's steps have no repository
// wrapper and want none: recording the run is a single UPDATE of a singleton
// row, and sweeping Limen's rate-limit table is housekeeping for a table
// this application does not otherwise own.
//
// Now is a function rather than a time so the scheduler's tick and a test's
// pinned clock reach the job the same way: readiness later compares the
// recorded run against the same clock the API reads, and a job that called
// time.Now itself would make that comparison untestable.
type Deps struct {
	Repo      *repo.Repo
	Q         *gen.Queries
	RateLimit ratelimit.Store
	Now       func() time.Time
}

// Result is what one retention pass did. Batches counts statements, not
// rows: it is how an operator tells a healthy nightly run (two statements,
// one per table) from a catch-up after days of cron silence.
type Result struct {
	MessagesPurged     int
	QuarantinePurged   int
	Batches            int
	InvitationsExpired int
	DurationMs         int64
}

// Retention is the nightly job: purge mail past its retention window, expire
// pending invitations, record the run, and prune both rate limiters'
// expired counters.
//
// The order matters in one place only: recording the run comes LAST, and
// only on success. `last_retention_run_at` is what /readyz reports as
// `retention.stale`, so stamping it before the work would turn a job that
// has been failing every night for a week into a readiness probe that says
// everything is fine — the exact failure the field exists to catch.
//
// The error is logged AND returned, the way retention.ts logged and
// re-threw: the log line is for whoever greps the runbook's event names, and
// the return value is what makes `mi-casa cron retention` exit non-zero so a
// scheduler records a failed run rather than a silent one.
//
// The purge is bounded at repo.PurgeBatchSize rows per statement so a
// catch-up run after a long outage never takes one enormous lock.
func Retention(ctx context.Context, d Deps) (Result, error) {
	startedAt := time.Now()
	now := d.Now().UTC()
	// The TypeScript logged an ISO string and the runbook's examples show
	// one, so this stays a string rather than becoming a bare time.Time.
	scheduledFor := now.Format(time.RFC3339Nano)

	result, err := run(ctx, d, now)
	result.DurationMs = time.Since(startedAt).Milliseconds()

	if err != nil {
		applog.Event(applog.LevelError, "retention_failed", map[string]any{
			"scheduledFor": scheduledFor,
			"durationMs":   result.DurationMs,
			"error":        err.Error(),
		})
		return result, err
	}

	applog.Event(applog.LevelInfo, "retention_completed", map[string]any{
		"scheduledFor":     scheduledFor,
		"messagesPurged":   result.MessagesPurged,
		"quarantinePurged": result.QuarantinePurged,
		"batches":          result.Batches,
		"durationMs":       result.DurationMs,
	})
	return result, nil
}

// run is Retention's body without the logging, so the success and failure
// lines are written in exactly one place each.
func run(ctx context.Context, d Deps, now time.Time) (Result, error) {
	var result Result

	purged, err := d.Repo.PurgeExpired(ctx, now, repo.PurgeBatchSize)
	if err != nil {
		return result, err
	}
	result.MessagesPurged = purged.Messages
	result.QuarantinePurged = purged.Quarantine
	result.Batches = purged.Batches

	// nil household: every household in one pass. The admin screens sweep
	// their own household before listing; this is the sweep that catches the
	// households nobody opened.
	expired, err := d.Repo.RefreshExpiredInvitations(ctx, now, nil)
	if err != nil {
		return result, err
	}
	result.InvitationsExpired = expired

	if err := d.Q.RecordRetentionRun(ctx, timestamptz(now)); err != nil {
		return result, err
	}

	// Both limiters, because neither prunes itself: ours through the Store
	// the middleware counts through, Limen's through its own table. The
	// Workers deployment got this for free from KV's TTLs; Postgres keeps
	// every row until something deletes it.
	if _, err := d.RateLimit.Sweep(ctx, now); err != nil {
		return result, err
	}
	if _, err := d.Q.SweepAuthRateLimits(ctx, timestamptz(now)); err != nil {
		return result, err
	}

	return result, nil
}

// timestamptz adapts a Go time to the driver's parameter type. internal/repo
// keeps its own unexported copy of this; four lines duplicated here are
// cheaper than exporting a conversion helper from a package whose job is not
// conversion.
func timestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t.UTC(), Valid: true}
}
