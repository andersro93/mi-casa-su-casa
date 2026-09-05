-- The app's own fixed-window rate limiter for the secret-bearing endpoints
-- (setup, invitations, household creation). Ported from Pjokk's
-- middleware.sql, which the migration reference names as the shape to follow
-- (REF §A5): key/count/expires_at with a Hit upsert, rather than the
-- TypeScript's last_request layout.
--
-- Distinct from Limen's "rate_limits" table, which Limen writes for the auth
-- endpoints; the two answer to different owners and are not shared.

-- name: HitRateLimit :one
-- One atomic increment, replacing the KV-era read-compare-write the Workers
-- deployment had to live with. The counter is exact even when several
-- replicas serve the same caller at once, which is the whole reason the
-- limiter moved into the database.
--
-- expires_at is only written on INSERT: the key already carries its window
-- number, so a bucket never outlives the window it was created for, and
-- refreshing the expiry on every hit would only let a busy bucket linger.
INSERT INTO "rate_limit" ("key", "count", "expires_at")
VALUES ($1, 1, $2)
ON CONFLICT ("key") DO UPDATE SET "count" = "rate_limit"."count" + 1
RETURNING "count";

-- name: SweepRateLimit :execrows
-- Housekeeping for counters whose window has passed; nothing reads
-- expires_at to decide whether a bucket counts, it exists only so this has
-- something to prune by. Returns how many rows went.
DELETE FROM "rate_limit"
WHERE "expires_at" < $1;

-- name: SweepAuthRateLimits :execrows
-- The same housekeeping for Limen's own "rate_limits" table. Limen creates
-- the rows and never prunes them (Cloudflare KV expired them by itself; a
-- Postgres table does not), so the retention job sweeps both tables in one
-- pass rather than leaving the auth limiter's counters to grow without
-- bound. The two tables stay separate — different owners, different keys —
-- but nobody else is going to clean this one up.
DELETE FROM "rate_limits"
WHERE "expires_at" < $1;
