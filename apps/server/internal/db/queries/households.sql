-- Queries over "households" — the tenant root. Ports the household half of
-- src/server/db/repositories/households.ts.
--
-- Nothing here is household-scoped in the tenancy sense (a household cannot
-- be "inside" itself); the scoping rule applies to every other file, where
-- household_id is the predicate that makes a query safe.

-- name: ListHouseholdsForUser :many
-- The household switcher's list. Ordered by lower(display_name) so "alpha"
-- and "Alpha" sort together rather than the way ASCII would have it — the
-- TypeScript ordered by the same expression.
SELECT "households"."id",
       "households"."slug",
       "households"."display_name",
       "household_memberships"."role"
FROM "household_memberships"
INNER JOIN "households" ON "households"."id" = "household_memberships"."household_id"
WHERE "household_memberships"."user_id" = $1
ORDER BY lower("households"."display_name") ASC;

-- name: GetHouseholdBySlug :one
SELECT "id", "slug", "display_name", "created_at", "updated_at"
FROM "households"
WHERE "slug" = $1;

-- name: GetHouseholdByID :one
SELECT "id", "slug", "display_name", "created_at", "updated_at"
FROM "households"
WHERE "id" = $1;

-- name: InsertHousehold :one
-- Half of CreateHousehold; the owner membership is the other half, and the
-- two run in one transaction (repo.CreateHousehold).
INSERT INTO "households" ("id", "slug", "display_name")
VALUES ($1, $2, $3)
RETURNING "id", "slug", "display_name", "created_at", "updated_at";

-- name: UpdateHouseholdDisplayName :one
-- updated_at is bumped explicitly: Postgres has no ON UPDATE trigger here,
-- and the settings screen shows the value.
UPDATE "households"
SET "display_name" = $2,
    "updated_at" = now()
WHERE "id" = $1
RETURNING "id", "slug", "display_name", "created_at", "updated_at";
