package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New opens a pgx connection pool against databaseURL. Unlike
// ApplyMigrations — which pins itself to a single physical connection so
// pg_advisory_lock's per-session semantics hold — this is a normal
// multi-connection pool for ordinary request traffic.
//
// The pool is pinged before it is handed back: pgxpool.New is lazy, so
// without this a bad URL or an unreachable database would only surface on
// the first request rather than at boot, where the operator is watching.
func New(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}
