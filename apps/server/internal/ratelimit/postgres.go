package ratelimit

import (
	"context"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Postgres is the Store the server actually runs on: the counters live in
// the "rate_limit" table, one row per key, incremented by the single
// upsert in internal/db/queries/ratelimit.sql.
//
// It is a thin adapter rather than more repository code because the counting
// rules (which window, how many, how long to wait) belong to this package;
// the repository only knows how to increment a row.
type Postgres struct {
	repo *repo.Repo
}

// NewPostgres wraps a repository as a Store.
func NewPostgres(r *repo.Repo) *Postgres { return &Postgres{repo: r} }

var _ Store = (*Postgres)(nil)

func (p *Postgres) Hit(ctx context.Context, key string, windowSeconds int) (int, error) {
	return p.repo.RateLimitHit(ctx, key, windowSeconds)
}

func (p *Postgres) Sweep(ctx context.Context, now time.Time) (int, error) {
	return p.repo.RateLimitSweep(ctx, now)
}
