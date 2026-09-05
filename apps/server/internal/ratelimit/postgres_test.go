package ratelimit_test

import (
	"context"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports test/integration/rate-limit.test.ts's "consumeRateLimit counts per
// window and resets after it" against the real table, which is where the
// counting actually happens.

func postgresStore(t *testing.T) (ratelimit.Store, *testrig.Rig) {
	t.Helper()
	rig := testrig.Setup(t)
	return ratelimit.NewPostgres(repo.New(rig.Pool)), rig
}

func TestPostgresBlocksTheSixthSetupAttemptInAWindow(t *testing.T) {
	store, _ := postgresStore(t)
	ctx := context.Background()
	rule := ratelimit.Setup
	now := time.Now().UTC().Truncate(time.Duration(rule.WindowSeconds) * time.Second).Add(time.Second)

	for attempt := 1; attempt <= rule.Max; attempt++ {
		decision, err := ratelimit.Consume(ctx, store, rule, "digest-a", now)
		if err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
		if !decision.Allowed {
			t.Fatalf("attempt %d of %d was blocked", attempt, rule.Max)
		}
	}

	blocked, err := ratelimit.Consume(ctx, store, rule, "digest-a", now)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if blocked.Allowed {
		t.Fatal("the sixth setup attempt within the window was allowed")
	}
	if blocked.RetryAfterSeconds < 1 {
		t.Fatalf("RetryAfterSeconds = %d, want at least 1", blocked.RetryAfterSeconds)
	}

	// A different client is unaffected.
	other, err := ratelimit.Consume(ctx, store, rule, "digest-b", now)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !other.Allowed {
		t.Fatal("a second client was blocked by the first client's attempts")
	}
}

func TestPostgresSweepRemovesExpiredCounters(t *testing.T) {
	store, rig := postgresStore(t)
	ctx := context.Background()
	rule := ratelimit.Setup
	now := time.Now().UTC()

	if _, err := store.Hit(ctx, rule.Key("digest-a", now), rule.WindowSeconds); err != nil {
		t.Fatalf("Hit: %v", err)
	}
	if _, err := rig.Pool.Exec(ctx, `UPDATE "rate_limit" SET "expires_at" = $1`, now.Add(-time.Hour)); err != nil {
		t.Fatalf("age the counter: %v", err)
	}

	removed, err := store.Sweep(ctx, now)
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if removed != 1 {
		t.Fatalf("Sweep removed %d counters, want 1", removed)
	}
}
