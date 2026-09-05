// Ports test/integration/retention.test.ts and the job-level half of
// test/integration/invitation-expiry.test.ts against a real Postgres: the
// batching, the invitation sweep, the recorded run and the readiness field
// that run feeds are the four things the nightly job exists to do, and every
// one of them is a database fact rather than a call the job made.
package jobs_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/jobs"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// scheduledAt is the instant every test in this file pins both clocks to:
// the job's Now and the readiness handler's, so "stale" is decided by the
// recorded run rather than by how long the suite took to get here.
var scheduledAt = time.Date(2026, 6, 1, 3, 0, 0, 0, time.UTC)

// depsFor builds jobs.Deps the way cmd/mi-casa's composition root does, from
// the rig's own collaborators.
func depsFor(app *testrig.AppRig) jobs.Deps {
	return jobs.Deps{
		Repo:      app.Deps.Repo,
		Q:         app.Rig.Q,
		RateLimit: app.Deps.RateLimit,
		Now:       app.Deps.Now,
	}
}

// captureLogs redirects internal/log for the duration of one test.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buffer := &bytes.Buffer{}
	applog.SetOutput(buffer)
	t.Cleanup(func() { applog.SetOutput(nil) })
	return buffer
}

// findEvent returns the first logged line whose "event" is name, decoded.
func findEvent(t *testing.T, logs *bytes.Buffer, name string) map[string]any {
	t.Helper()
	for _, line := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		if line == "" {
			continue
		}
		var fields map[string]any
		if err := json.Unmarshal([]byte(line), &fields); err != nil {
			t.Fatalf("log line is not JSON: %q (%v)", line, err)
		}
		if fields["event"] == name {
			return fields
		}
	}
	t.Fatalf("no %q line in the log:\n%s", name, logs.String())
	return nil
}

// seedMessages writes n expired-or-not messages for one provider in one
// statement. generate_series rather than a loop: the batching assertion
// needs more rows than the batch size, and 600 round trips would dominate
// the test's runtime for no extra coverage.
func seedMessages(t *testing.T, app *testrig.AppRig, householdID, providerID string, n int, deleteAfter time.Time) {
	t.Helper()
	if _, err := app.Rig.Pool.Exec(t.Context(), `
		INSERT INTO "messages" (
			"id", "message_id", "household_id", "provider_id", "envelope_from",
			"envelope_to", "text_body", "classification_reason", "raw_size",
			"received_at", "delete_after")
		SELECT
			'm-' || $4::text || '-' || i, '<m-' || $4::text || '-' || i || '@test>',
			$1, $2, 'sender@service.example', 'casa@inbox.example.com',
			'body', 'seeded', 1, $3::timestamptz - interval '30 days', $3::timestamptz
		FROM generate_series(1, $5::int) AS i`,
		householdID, providerID, deleteAfter, deleteAfter.Format(time.RFC3339), n,
	); err != nil {
		t.Fatalf("seed %d messages: %v", n, err)
	}
}

// seedQuarantine is seedMessages for the needs-review table, which has no
// provider and its own uniqueness constraint.
func seedQuarantine(t *testing.T, app *testrig.AppRig, householdID string, n int, deleteAfter time.Time) {
	t.Helper()
	if _, err := app.Rig.Pool.Exec(t.Context(), `
		INSERT INTO "quarantine_messages" (
			"id", "message_id", "household_id", "envelope_from", "envelope_to",
			"text_body", "quarantine_reason", "raw_size", "received_at", "delete_after")
		SELECT
			'q-' || $3::text || '-' || i, '<q-' || $3::text || '-' || i || '@test>',
			$1, 'sender@service.example', 'casa@inbox.example.com',
			'body', 'no rule matched', 1, $2::timestamptz - interval '30 days', $2::timestamptz
		FROM generate_series(1, $4::int) AS i`,
		householdID, deleteAfter, deleteAfter.Format(time.RFC3339), n,
	); err != nil {
		t.Fatalf("seed %d quarantine rows: %v", n, err)
	}
}

// readyz drives GET /readyz through the whole handler and returns the
// retention half of the payload.
func readyz(t *testing.T, app *testrig.AppRig) map[string]any {
	t.Helper()
	rec := app.Do(t, http.MethodGet, "/readyz", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /readyz = %d, body %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)
	retention, ok := body["retention"].(map[string]any)
	if !ok {
		t.Fatalf("readyz body has no retention object: %s", rec.Body.String())
	}
	return retention
}

// The whole job in one pass, exactly as retention.test.ts drove it: more
// expired mail than one batch can hold, some mail that is not expired, an
// invitation past its expiry beside a fresh one, and a /readyz that goes
// from stale to fresh because of what the job recorded.
func TestRetentionPurgesInBatchesExpiresInvitationsAndClearsStaleness(t *testing.T) {
	app := testrig.App(t)
	app.CompleteSetup(t)
	app.SetNow(scheduledAt)

	household, err := app.Deps.Repo.GetHouseholdBySlug(t.Context(), testrig.OwnerHouseholdSlug)
	if err != nil || household == nil {
		t.Fatalf("GetHouseholdBySlug: %v", err)
	}
	provider, err := app.Deps.Repo.CreateProvider(t.Context(), household.ID, "netflix", "Netflix")
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}

	// 600 > the job's batch of 500, so the message sweep takes two
	// statements and the batch loop is genuinely exercised (the TypeScript
	// test shrank the batch instead; the Go job's batch size is a constant
	// the deployment relies on, so the fixture is what gets bigger).
	expired := scheduledAt.Add(-24 * time.Hour)
	fresh := scheduledAt.AddDate(0, 0, 30)
	seedMessages(t, app, household.ID, provider.ID, 600, expired)
	seedMessages(t, app, household.ID, provider.ID, 5, fresh)
	seedQuarantine(t, app, household.ID, 3, expired)
	seedQuarantine(t, app, household.ID, 1, fresh)

	// One invitation that expired earlier the same day and one that has not
	// (invitation-expiry.test.ts's first two cases, seen from the job).
	expiredInvite := scheduledAt.Add(-8 * time.Hour)
	app.Invite(t, testrig.OwnerHouseholdSlug, "late@example.com", "Late", "member", &expiredInvite)
	app.Invite(t, testrig.OwnerHouseholdSlug, "soon@example.com", "Soon", "member", nil)

	// Expired counters in BOTH limiters: ours and Limen's. Nothing else
	// prunes either table.
	if _, err := app.Rig.Pool.Exec(t.Context(),
		`INSERT INTO "rate_limit" ("key", "count", "expires_at") VALUES ('app:setup:1:0', 1, $1)`,
		scheduledAt.Add(-time.Hour),
	); err != nil {
		t.Fatalf("seed app rate limit: %v", err)
	}
	if _, err := app.Rig.Pool.Exec(t.Context(),
		`INSERT INTO "rate_limits" ("key", "count", "expires_at") VALUES ('limen:signin:1', 1, $1)`,
		scheduledAt.Add(-time.Hour),
	); err != nil {
		t.Fatalf("seed limen rate limit: %v", err)
	}

	before := readyz(t, app)
	if before["lastRunAt"] != nil || before["stale"] != true {
		t.Fatalf("readyz before the job = %+v, want {lastRunAt:null, stale:true}", before)
	}

	logs := captureLogs(t)
	result, err := jobs.Retention(t.Context(), depsFor(app))
	if err != nil {
		t.Fatalf("Retention: %v", err)
	}

	if result.MessagesPurged != 600 {
		t.Errorf("MessagesPurged = %d, want 600", result.MessagesPurged)
	}
	if result.QuarantinePurged != 3 {
		t.Errorf("QuarantinePurged = %d, want 3", result.QuarantinePurged)
	}
	// Two statements for the 600 messages (500 then 100), one for the three
	// quarantine rows: a short batch is what ends each table's loop.
	if result.Batches != 3 {
		t.Errorf("Batches = %d, want 3 (2 for messages, 1 for quarantine)", result.Batches)
	}
	if result.InvitationsExpired != 1 {
		t.Errorf("InvitationsExpired = %d, want 1", result.InvitationsExpired)
	}
	if result.DurationMs < 0 {
		t.Errorf("DurationMs = %d, want a non-negative duration", result.DurationMs)
	}

	if got := app.Count(t, "messages", ""); got != 5 {
		t.Errorf("messages left = %d, want the 5 unexpired ones", got)
	}
	if got := app.Count(t, "quarantine_messages", ""); got != 1 {
		t.Errorf("quarantine rows left = %d, want the 1 unexpired one", got)
	}
	if got := app.Count(t, "household_invitations", "status = 'expired'"); got != 1 {
		t.Errorf("expired invitations = %d, want 1", got)
	}
	if got := app.Count(t, "household_invitations", "status = 'pending'"); got != 1 {
		t.Errorf("pending invitations = %d, want the fresh one", got)
	}
	// Only the EXPIRED counters go: CompleteSetup left a live one of its
	// own behind, and a sweep that took that too would reset a limiter
	// mid-window.
	if got := app.Count(t, "rate_limit", `"expires_at" < $1`, scheduledAt); got != 0 {
		t.Errorf("expired app rate-limit counters left = %d, want 0", got)
	}
	if got := app.Count(t, "rate_limit", `"key" = 'app:setup:1:0'`); got != 0 {
		t.Errorf("the seeded expired app counter survived the sweep")
	}
	if got := app.Count(t, "rate_limits", ""); got != 0 {
		t.Errorf("Limen rate-limit counters left = %d, want 0", got)
	}

	installation, err := app.Rig.Q.GetInstallation(t.Context())
	if err != nil {
		t.Fatalf("GetInstallation: %v", err)
	}
	if !installation.LastRetentionRunAt.Valid || !installation.LastRetentionRunAt.Time.Equal(scheduledAt) {
		t.Errorf("last_retention_run_at = %v, want %s", installation.LastRetentionRunAt, scheduledAt)
	}

	// REF §A7's field list, verbatim: the operations runbook tells people to
	// grep these names.
	completed := findEvent(t, logs, "retention_completed")
	if completed["level"] != "info" {
		t.Errorf("retention_completed level = %v, want info", completed["level"])
	}
	if completed["scheduledFor"] != scheduledAt.Format(time.RFC3339Nano) {
		t.Errorf("scheduledFor = %v, want %s", completed["scheduledFor"], scheduledAt.Format(time.RFC3339Nano))
	}
	if completed["messagesPurged"] != float64(600) || completed["quarantinePurged"] != float64(3) ||
		completed["batches"] != float64(3) {
		t.Errorf("retention_completed counts = %+v", completed)
	}
	if _, ok := completed["durationMs"]; !ok {
		t.Errorf("retention_completed has no durationMs: %+v", completed)
	}

	after := readyz(t, app)
	if after["stale"] != false {
		t.Errorf("readyz after the job = %+v, want stale:false", after)
	}
	lastRunAt, ok := after["lastRunAt"].(string)
	if !ok {
		t.Fatalf("readyz lastRunAt = %v, want the recorded instant", after["lastRunAt"])
	}
	parsed, err := time.Parse(time.RFC3339Nano, lastRunAt)
	if err != nil || !parsed.Equal(scheduledAt) {
		t.Errorf("readyz lastRunAt = %q, want %s", lastRunAt, scheduledAt)
	}
}

// An empty database still costs one statement per table, and must not be an
// error: the job runs nightly whether or not anything expired.
func TestRetentionOnAnEmptyDatabaseRecordsTheRun(t *testing.T) {
	app := testrig.App(t)
	app.SetNow(scheduledAt)
	captureLogs(t)

	result, err := jobs.Retention(t.Context(), depsFor(app))
	if err != nil {
		t.Fatalf("Retention: %v", err)
	}
	if result.MessagesPurged != 0 || result.QuarantinePurged != 0 || result.InvitationsExpired != 0 {
		t.Errorf("result = %+v, want zero counts", result)
	}
	if result.Batches != 2 {
		t.Errorf("Batches = %d, want 2 (one probe per table)", result.Batches)
	}

	installation, err := app.Rig.Q.GetInstallation(t.Context())
	if err != nil {
		t.Fatalf("GetInstallation: %v", err)
	}
	if !installation.LastRetentionRunAt.Valid {
		t.Error("last_retention_run_at is null after a successful run")
	}
}

// A failed run must be visible as a failure: logged with the reason and
// returned, so `mi-casa cron retention` exits non-zero and the scheduler
// logs it rather than quietly recording a run that did not happen.
func TestRetentionFailureLogsAndReturnsTheError(t *testing.T) {
	app := testrig.App(t)
	app.SetNow(scheduledAt)

	// A closed pool is the cheapest honest "the database went away": every
	// statement the job issues fails, starting with the first purge.
	app.Rig.Pool.Close()

	logs := captureLogs(t)
	_, err := jobs.Retention(t.Context(), depsFor(app))
	if err == nil {
		t.Fatal("Retention against a closed pool returned nil, want an error")
	}

	failed := findEvent(t, logs, "retention_failed")
	if failed["level"] != "error" {
		t.Errorf("retention_failed level = %v, want error", failed["level"])
	}
	if failed["scheduledFor"] != scheduledAt.Format(time.RFC3339Nano) {
		t.Errorf("scheduledFor = %v, want %s", failed["scheduledFor"], scheduledAt.Format(time.RFC3339Nano))
	}
	if _, ok := failed["durationMs"]; !ok {
		t.Errorf("retention_failed has no durationMs: %+v", failed)
	}
	message, ok := failed["error"].(string)
	if !ok || message == "" {
		t.Errorf("retention_failed error = %v, want the failure's message", failed["error"])
	}
	// retention_completed must NOT also be there: a run either finished or
	// it did not.
	if strings.Contains(logs.String(), "retention_completed") {
		t.Errorf("a failed run also logged retention_completed:\n%s", logs.String())
	}
}

// Deps.RateLimit is the app's Store, not the repository, so the job sweeps
// through the same interface the middleware counts through. Asserting the
// call happened (rather than only the rows going) keeps that wiring honest.
func TestRetentionSweepsThroughTheRateLimitStore(t *testing.T) {
	app := testrig.App(t)
	app.SetNow(scheduledAt)
	captureLogs(t)

	counting := &countingStore{inner: app.Deps.RateLimit}
	deps := depsFor(app)
	deps.RateLimit = counting

	if _, err := jobs.Retention(t.Context(), deps); err != nil {
		t.Fatalf("Retention: %v", err)
	}
	if counting.sweeps != 1 {
		t.Errorf("Store.Sweep calls = %d, want 1", counting.sweeps)
	}
}

type countingStore struct {
	inner  ratelimit.Store
	sweeps int
}

var _ ratelimit.Store = (*countingStore)(nil)

func (c *countingStore) Hit(ctx context.Context, key string, windowSeconds int) (int, error) {
	return c.inner.Hit(ctx, key, windowSeconds)
}

func (c *countingStore) Sweep(ctx context.Context, now time.Time) (int, error) {
	c.sweeps++
	return c.inner.Sweep(ctx, now)
}
