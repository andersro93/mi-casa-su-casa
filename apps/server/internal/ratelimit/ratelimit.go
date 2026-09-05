// Package ratelimit is the app's own fixed-window brake on the endpoints
// that carry a secret: first-run setup, invitation tokens and household
// creation (REF §A1, "Rate limiting").
//
// Ported from src/server/security/rate-limit.ts. Two things changed in the
// move off Workers, both deliberate:
//
//   - The client is no longer cf-connecting-ip. There is no header a caller
//     cannot forge outside Cloudflare, so the address comes from
//     security.ClientIP (socket address, or the trusted hop in
//     X-Forwarded-For) and reaches this package already digested — a
//     rate-limit row outlives the request, and a database dump should not be
//     a record of who visited.
//
//   - The window is part of the key rather than a last_request column. The
//     TypeScript kept `count` and `last_request` in one row and reset the
//     count when last_request fell outside the window; the Go schema
//     (internal/db/queries/ratelimit.sql, ported from Pjokk) has only
//     key/count/expires_at and one atomic increment. A bucket therefore has
//     to be addressed by the window it belongs to, or it would never reset
//     until the sweeper happened to run — which would turn "five attempts
//     per fifteen minutes" into "five attempts, then wait for a cron job".
//
// The second point is the one deviation from the brief's stated key layout
// ("app:<rule>:<client>"): that prefix is kept exactly, with the window
// number appended.
package ratelimit

import (
	"context"
	"strconv"
	"time"
)

// Store is where the counters live. The interface exists so the middleware
// can be exercised without a database, and so a future Redis-backed store is
// a swap rather than a rewrite.
type Store interface {
	// Hit increments the counter for key and returns the count after the
	// increment, so the first call in a window returns 1.
	Hit(ctx context.Context, key string, windowSeconds int) (int, error)

	// Sweep deletes counters whose window has passed, returning how many
	// rows went. Nothing reads the expiry to decide whether a bucket counts
	// — the window is in the key — so this is pure housekeeping.
	Sweep(ctx context.Context, now time.Time) (int, error)
}

// Rule is one limit: a label that names the bucket, the window length and
// how many requests fit in it.
type Rule struct {
	// Name is the short label in the storage key, e.g. "setup".
	Name string
	// WindowSeconds is the window length.
	WindowSeconds int
	// Max is the number of requests one client may make per window.
	Max int
}

// The three rules, unchanged from RATE_LIMITS in the TypeScript.
var (
	// Setup: guessing SETUP_SECRET must be slow.
	Setup = Rule{Name: "setup", WindowSeconds: 15 * 60, Max: 5}
	// Invitations: token lookups and acceptance, which together are the one
	// unauthenticated path that reveals whether a token exists.
	Invitations = Rule{Name: "invitations", WindowSeconds: 10 * 60, Max: 20}
	// HouseholdCreate: household creation by an authenticated user.
	HouseholdCreate = Rule{Name: "household-create", WindowSeconds: 60 * 60, Max: 10}
)

// Key is the storage key for one client in the window containing now:
// "app:<rule>:<client digest>:<window number>".
//
// client must already be digested (see security.IPDigest); this package
// never sees a raw address and so cannot leak one into the table.
func (r Rule) Key(client string, now time.Time) string {
	return "app:" + r.Name + ":" + client + ":" + strconv.FormatInt(r.window(now), 10)
}

// RetryAfter is the number of seconds until the current window ends — what
// goes in the Retry-After header. Never below 1: telling a caller to retry
// in zero seconds only produces another rejection.
func (r Rule) RetryAfter(now time.Time) int {
	end := (r.window(now) + 1) * int64(r.WindowSeconds)
	seconds := end - now.Unix()
	if seconds < 1 {
		return 1
	}
	return int(seconds)
}

// window numbers the fixed windows since the epoch. Two requests in the same
// window share a number, and therefore a counter.
func (r Rule) window(now time.Time) int64 {
	if r.WindowSeconds <= 0 {
		return 0
	}
	return now.Unix() / int64(r.WindowSeconds)
}

// Decision is the answer for one request: either it is allowed (and how many
// remain in this window), or it is not (and when to come back).
type Decision struct {
	Allowed           bool
	Remaining         int
	RetryAfterSeconds int
}

// Consume counts one request against rule for client and says whether it may
// proceed. Ported from consumeRateLimit; the increment is a single statement
// in the store, so several replicas serving the same caller cannot both read
// "4" and both let a request through.
func Consume(ctx context.Context, store Store, rule Rule, client string, now time.Time) (Decision, error) {
	count, err := store.Hit(ctx, rule.Key(client, now), rule.WindowSeconds)
	if err != nil {
		return Decision{}, err
	}

	if count > rule.Max {
		return Decision{RetryAfterSeconds: rule.RetryAfter(now)}, nil
	}
	return Decision{Allowed: true, Remaining: rule.Max - count}, nil
}
