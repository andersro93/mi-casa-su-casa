package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
)

// The app's fixed-window rate limiter, ported from Pjokk's (REF §A5). The
// TypeScript kept its counters in Cloudflare KV, which was eventually
// consistent: it read a value, compared it and wrote it back, a race its own
// comment accepted as "a brake, not an invariant". Postgres removes the
// compromise — one statement increments and returns the new count — so the
// limit holds even when several replicas serve the same caller at once.

// RateLimitHit increments the counter for key and returns the count after
// incrementing.
//
// The row's expiry is kept generous — at least a minute, otherwise twice the
// window — so clock skew between replicas cannot resurrect a bucket that
// should already have expired. Nothing reads expires_at to decide whether a
// bucket counts: the window number is part of the key, and the expiry exists
// only so RateLimitSweep has something to prune by.
func (r *Repo) RateLimitHit(ctx context.Context, key string, windowSeconds int) (int, error) {
	ttl := time.Duration(windowSeconds) * 2 * time.Second
	if ttl < time.Minute {
		ttl = time.Minute
	}
	count, err := r.q.HitRateLimit(ctx, gen.HitRateLimitParams{
		Key:       key,
		ExpiresAt: ts(time.Now().UTC().Add(ttl)),
	})
	if err != nil {
		return 0, fmt.Errorf("repo: rate limit hit %q: %w", key, err)
	}
	return int(count), nil
}

// RateLimitSweep deletes every counter whose window has passed, returning how
// many rows went.
func (r *Repo) RateLimitSweep(ctx context.Context, now time.Time) (int, error) {
	removed, err := r.q.SweepRateLimit(ctx, ts(now.UTC()))
	if err != nil {
		return 0, fmt.Errorf("repo: rate limit sweep: %w", err)
	}
	return int(removed), nil
}
