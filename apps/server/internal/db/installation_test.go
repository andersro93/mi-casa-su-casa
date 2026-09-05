package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// TestRecordRetentionRun_StoresCallersTimestamp pins the reason ran_at is a
// parameter at all: readiness compares last_retention_run_at against a
// staleness window, so the stamp has to be the caller's clock reading —
// exactly, to the microsecond Postgres stores — and not whatever now() the
// database happened to evaluate. The assertion below only holds if the value
// makes the round trip untouched, which a now() implementation could never
// satisfy.
func TestRecordRetentionRun_StoresCallersTimestamp(t *testing.T) {
	rig := testrig.Setup(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Deliberately not "around now": a timestamp a fortnight in the past is
	// one no now() could produce by accident, so a regression to now() fails
	// this test loudly rather than intermittently.
	ranAt := time.Date(2026, time.August, 21, 4, 30, 15, 123456000, time.UTC)

	if err := rig.Q.RecordRetentionRun(ctx, pgtype.Timestamptz{Time: ranAt, Valid: true}); err != nil {
		t.Fatalf("RecordRetentionRun: %v", err)
	}

	installation, err := rig.Q.GetInstallation(ctx)
	if err != nil {
		t.Fatalf("GetInstallation: %v", err)
	}
	if !installation.LastRetentionRunAt.Valid {
		t.Fatalf("expected last_retention_run_at to be set, got NULL")
	}
	if got := installation.LastRetentionRunAt.Time; !got.Equal(ranAt) {
		t.Fatalf("expected last_retention_run_at %s, got %s", ranAt, got)
	}
}

// TestRecordRetentionRun_LeavesSetupStateAlone guards the blast radius: the
// retention cron writes to the same singleton row the setup state machine
// owns, and a stamp that also disturbed status would re-open or close
// first-run setup as a side effect of a nightly job.
func TestRecordRetentionRun_LeavesSetupStateAlone(t *testing.T) {
	rig := testrig.Setup(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	before, err := rig.Q.GetInstallation(ctx)
	if err != nil {
		t.Fatalf("GetInstallation (before): %v", err)
	}

	ranAt := time.Date(2026, time.August, 21, 4, 30, 15, 123456000, time.UTC)
	if err := rig.Q.RecordRetentionRun(ctx, pgtype.Timestamptz{Time: ranAt, Valid: true}); err != nil {
		t.Fatalf("RecordRetentionRun: %v", err)
	}

	after, err := rig.Q.GetInstallation(ctx)
	if err != nil {
		t.Fatalf("GetInstallation (after): %v", err)
	}
	if after.Status != before.Status {
		t.Fatalf("expected status to stay %q, got %q", before.Status, after.Status)
	}
	if after.OwnerUserID != nil {
		t.Fatalf("expected owner_user_id to stay NULL, got %q", *after.OwnerUserID)
	}
}
