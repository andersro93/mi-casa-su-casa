// Package repo is the household-scoped data layer: one thin Go wrapper per
// query in internal/db/queries, mapping generated rows onto the types the
// HTTP layer serialises.
//
// It ports src/server/db/repositories/*.ts. Two rules carried over from
// there survive the move to Postgres and are worth stating once:
//
//   - Tenancy is a predicate, not a convention. Every statement that touches
//     a household-owned table carries a household_id (or joins one) in its
//     WHERE clause, so a caller that forgets to check membership still
//     cannot read another household's rows. The TypeScript predecessor
//     enforced this through a `forHousehold(db, id)` façade; here it is
//     enforced in the SQL itself, which no call site can bypass.
//   - Ids are minted by the application, not the database. The columns are
//     `text` primary keys with no default: an id is often needed before the
//     row exists (an invitation's token is hashed against a row that is
//     written in the same batch), and generating them in one place keeps the
//     format identical to the UUIDs the Workers deployment wrote.
//
// What the D1 predecessor did with `database.batch(...)` — its only
// approximation of a transaction — is done here with InTx, which is a real
// one: a failure halfway through a two-statement write leaves nothing
// behind.
package repo

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
)

// Repo owns the pool (for transactions) and a querier bound to it (for
// everything else).
type Repo struct {
	pool *pgxpool.Pool
	q    *gen.Queries
}

// New builds a repository over an existing pool, so the whole process shares
// the one pool the composition root opened.
func New(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool, q: gen.New(pool)}
}

// Queries exposes the generated querier for callers that legitimately need a
// query this package does not wrap yet (the health probe's SELECT 1, say).
// It is deliberately read-only-ish: everything the HTTP layer needs has a
// method on Repo.
func (r *Repo) Queries() *gen.Queries { return r.q }

// Pool exposes the underlying pool for the same reason.
func (r *Repo) Pool() *pgxpool.Pool { return r.pool }

// InTx runs fn against a querier bound to a single transaction, committing
// when it returns nil and rolling back on any error or panic.
//
// This is what replaces D1's `batch`: the multi-statement writes (creating a
// household with its owner membership, accepting an invitation, releasing a
// quarantined message) are all-or-nothing, so a half-applied write cannot
// leave a household without an owner or an invitation accepted by nobody.
func (r *Repo) InTx(ctx context.Context, fn func(q *gen.Queries) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("repo: begin transaction: %w", err)
	}
	// Rollback after a successful Commit is a no-op that returns
	// pgx.ErrTxClosed, so this is safe to defer unconditionally and covers
	// the panic path as well as the error paths below.
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(r.q.WithTx(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("repo: commit transaction: %w", err)
	}
	return nil
}

// IsUniqueViolation reports whether err is Postgres' unique_violation
// (SQLSTATE 23505).
//
// The API error handler turns these into 409s ("Household slug already
// exists", "Provider key already exists", …) rather than 500s, which is what
// the TypeScript error handler did by string-matching SQLite's "UNIQUE
// constraint failed" message. A SQLSTATE is the same idea done properly: it
// survives translation and does not depend on the wording of a driver
// message.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// UniqueViolationConstraint names the constraint a unique violation broke,
// or "" when err is not one. The error handler maps constraint names to the
// user-facing messages, so it needs to tell a slug clash from a provider-key
// clash.
func UniqueViolationConstraint(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return pgErr.ConstraintName
	}
	return ""
}

// ErrNoRows re-exports pgx's sentinel so callers can tell "nothing matched"
// from a real failure without importing pgx. The wrappers here mostly
// translate it into a nil pointer already; this is for the ones that cannot.
var ErrNoRows = pgx.ErrNoRows

const (
	// DefaultPageSize and MaxPageSize are the TypeScript constants of the
	// same name (src/server/db/repositories/messages.ts).
	DefaultPageSize = 50
	MaxPageSize     = 200
)

// Page is a normalised keyset page request: how many rows, and the cursor
// they must be older than.
type Page struct {
	Limit int
	// Before is the exclusive upper bound on received_at, or nil for the
	// first page.
	Before *time.Time
}

// Paged is one page of rows plus the cursor for the next (older) one.
//
// NextBefore is nil when this was the last page. It is a pointer rather than
// a zero time so it marshals as JSON null, which is what the SPA checks to
// decide whether to offer "load more".
type Paged[T any] struct {
	Items      []T        `json:"items"`
	NextBefore *time.Time `json:"nextBefore"`
}

// NormalizePage ports normalizePageOptions: the limit is clamped to
// 1..MaxPageSize (a missing or unparseable one becomes DefaultPageSize), and
// `before` is accepted only when it parses as a timestamp.
//
// A garbage cursor is dropped rather than rejected on purpose — carried over
// from the TypeScript, where an unparseable `before` simply meant "start at
// the newest" instead of erroring a page the user can no longer navigate
// away from.
func NormalizePage(limit int, before string) Page {
	page := Page{Limit: limit}
	switch {
	case limit == 0: // absent: the query parameter is optional
		page.Limit = DefaultPageSize
	case limit < 1:
		page.Limit = 1
	case limit > MaxPageSize:
		page.Limit = MaxPageSize
	}

	if before != "" {
		if parsed, err := time.Parse(time.RFC3339, before); err == nil {
			utc := parsed.UTC()
			page.Before = &utc
		}
	}
	return page
}

// toPage trims the limit+1 rows a paging query fetches down to the page the
// caller asked for, using the extra row only to decide whether a next page
// exists. receivedAt reads the cursor column out of a row.
func toPage[T any](rows []T, limit int, receivedAt func(T) time.Time) Paged[T] {
	if len(rows) > limit {
		items := rows[:limit]
		cursor := receivedAt(items[len(items)-1])
		return Paged[T]{Items: items, NextBefore: &cursor}
	}
	if rows == nil {
		rows = []T{}
	}
	return Paged[T]{Items: rows, NextBefore: nil}
}

// newID mints an application-side id: a random (version 4) UUID in the same
// canonical form crypto.randomUUID() produced on Workers, so ids written by
// the two deployments are indistinguishable.
func newID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("repo: read random bytes: %w", err)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx (RFC 4122)
	return fmt.Sprintf("%x-%x-%x-%x-%x",
		bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}

// ts wraps a time for a NOT NULL timestamptz parameter.
func ts(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// tsPtr wraps an optional time for a nullable timestamptz parameter.
func tsPtr(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// fromTS reads a NOT NULL timestamptz column. The database always sends a
// value for those, so an invalid one can only mean a schema drift; it
// becomes the zero time rather than a panic.
//
// Values come back in UTC so JSON renders "…Z", matching the ISO strings the
// SPA has always parsed.
func fromTS(v pgtype.Timestamptz) time.Time {
	if !v.Valid {
		return time.Time{}
	}
	return v.Time.UTC()
}

// fromTSPtr reads a nullable timestamptz column into a pointer, so JSON
// renders null rather than "0001-01-01T00:00:00Z".
func fromTSPtr(v pgtype.Timestamptz) *time.Time {
	if !v.Valid {
		return nil
	}
	utc := v.Time.UTC()
	return &utc
}
