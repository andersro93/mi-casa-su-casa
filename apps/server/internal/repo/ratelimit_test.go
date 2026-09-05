package repo_test

import (
	"testing"
	"time"
)

// Ports the counter half of test/integration/rate-limit.test.ts (the HTTP
// behaviour arrives with the middleware in a later task).

func TestRateLimitHitCountsPerKey(t *testing.T) {
	r, _ := setup(t)
	c := ctx(t)

	for want := 1; want <= 3; want++ {
		count, err := r.RateLimitHit(c, "rl:setup:1.2.3.4:900", 60)
		if err != nil {
			t.Fatalf("RateLimitHit: %v", err)
		}
		if count != want {
			t.Fatalf("RateLimitHit = %d, want %d", count, want)
		}
	}

	// A different key is a different bucket.
	other, err := r.RateLimitHit(c, "rl:setup:5.6.7.8:900", 60)
	if err != nil || other != 1 {
		t.Fatalf("RateLimitHit(other key) = %d (%v), want 1", other, err)
	}
}

func TestRateLimitSweepRemovesExpiredCounters(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)

	if _, err := r.RateLimitHit(c, "rl:old", 60); err != nil {
		t.Fatalf("RateLimitHit: %v", err)
	}
	if _, err := r.RateLimitHit(c, "rl:fresh", 60); err != nil {
		t.Fatalf("RateLimitHit: %v", err)
	}
	// Age one bucket past its window.
	if _, err := rig.Pool.Exec(c,
		`UPDATE "rate_limit" SET "expires_at" = $1 WHERE "key" = 'rl:old'`,
		time.Now().UTC().Add(-time.Hour),
	); err != nil {
		t.Fatalf("age the counter: %v", err)
	}

	removed, err := r.RateLimitSweep(c, time.Now().UTC())
	if err != nil {
		t.Fatalf("RateLimitSweep: %v", err)
	}
	if removed != 1 {
		t.Fatalf("RateLimitSweep removed %d, want 1", removed)
	}
	if got := countRows(t, rig, "rate_limit", ""); got != 1 {
		t.Fatalf("counters left = %d, want 1", got)
	}
}
