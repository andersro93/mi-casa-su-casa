-- Queries over Limen's "sessions" table, backing the account settings
-- screen's device list. Ports the session half of
-- src/server/db/repositories/settings.ts.
--
-- Limen owns writing these rows; we only list a user's own and revoke them.
-- Every statement carries the user_id, so a session id learned from
-- somewhere else cannot be used to revoke another person's device.

-- name: ListUserSessions :many
-- Newest first. metadata is an opaque JSON *string* Limen writes; the caller
-- unpacks the ip_address digest and user agent from it for the device list
-- (REF §B4).
SELECT "id", "user_id", "created_at", "expires_at", "last_access", "metadata"
FROM "sessions"
WHERE "user_id" = $1
ORDER BY "created_at" DESC;

-- name: DeleteSession :exec
-- Silently deletes nothing when the session belongs to someone else, which
-- is the behaviour the route wants: revoking a session you do not own is not
-- an error to report back, it is simply not a session you have.
DELETE FROM "sessions"
WHERE "user_id" = $1 AND "id" = $2;

-- name: DeleteOtherSessions :exec
-- "Sign out everywhere else": every session of this user except the one the
-- request arrived on.
DELETE FROM "sessions"
WHERE "user_id" = $1 AND "id" <> $2;
