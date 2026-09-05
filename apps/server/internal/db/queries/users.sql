-- Queries over Limen's "users" table. Ports
-- src/server/db/repositories/users.ts and the profile half of settings.ts.
--
-- Rows here are Limen's to create and authenticate; this file only reads
-- them, updates the three display columns that are ours (name, image,
-- two_factor_enabled — REF §A5), and deletes an account outright.

-- name: FindUserByEmail :one
-- The address is normalised by the caller (trimmed and lower-cased) so a
-- typed-in "Owner@Example.COM" finds the account sign-up created.
SELECT "id", "email", "name"
FROM "users"
WHERE "email" = $1;

-- name: FindUserByID :one
SELECT "id", "email", "name"
FROM "users"
WHERE "id" = $1;

-- name: DeleteUser :exec
-- Sessions, accounts, two-factor secrets and household memberships cascade.
-- Used to compensate for an interrupted flow (a setup or invitation accept
-- that created the account and then failed), not as an ordinary operation.
DELETE FROM "users" WHERE "id" = $1;

-- name: GetUserProfile :one
SELECT "id", "email", "name", "image", "two_factor_enabled"
FROM "users"
WHERE "id" = $1;

-- name: UpdateUserProfile :exec
-- image is nullable: the settings screen sends "" to clear an avatar, which
-- the caller turns into NULL rather than storing an empty string that would
-- render as a broken image.
UPDATE "users"
SET "name" = sqlc.arg(name),
    "image" = sqlc.narg(image),
    "updated_at" = now()
WHERE "id" = sqlc.arg(id);
