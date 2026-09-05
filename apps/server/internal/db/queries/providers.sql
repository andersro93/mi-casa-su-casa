-- Queries over "providers" — the services a household receives mail from.
-- Ports the provider half of src/server/db/repositories/provider-rules.ts
-- and listProviders from member-access.ts.
--
-- Every statement is scoped by household_id, including the ones that take a
-- provider id: a provider id is a UUID a caller could have learned from
-- another household's page, and "WHERE id = $1" alone would hand it over.

-- name: ListProviderConfigurations :many
-- The admin providers screen: each provider with how many sender rules point
-- at it, so the UI can flag one that would never match anything.
SELECT "providers"."id",
       "providers"."household_id",
       "providers"."provider_key",
       "providers"."display_name",
       "providers"."created_at",
       count("sender_rules"."id") AS "rule_count"
FROM "providers"
LEFT JOIN "sender_rules" ON "sender_rules"."provider_id" = "providers"."id"
WHERE "providers"."household_id" = $1
GROUP BY "providers"."id"
ORDER BY "providers"."display_name" ASC;

-- name: ListProviders :many
SELECT "id", "household_id", "provider_key", "display_name", "created_at"
FROM "providers"
WHERE "household_id" = $1
ORDER BY "display_name" ASC;

-- name: GetProviderByKey :one
SELECT "id", "household_id", "provider_key", "display_name", "created_at"
FROM "providers"
WHERE "household_id" = $1 AND "provider_key" = $2;

-- name: GetProviderByID :one
SELECT "id", "household_id", "provider_key", "display_name", "created_at"
FROM "providers"
WHERE "household_id" = $1 AND "id" = $2;

-- name: InsertProvider :one
-- A duplicate provider_key within the household raises 23505 on
-- providers_household_key_unique, which the API turns into 409 "Provider key
-- already exists".
INSERT INTO "providers" ("id", "household_id", "provider_key", "display_name")
VALUES ($1, $2, $3, $4)
RETURNING "id", "household_id", "provider_key", "display_name", "created_at";

-- name: UpdateProvider :one
UPDATE "providers"
SET "provider_key" = sqlc.arg(provider_key),
    "display_name" = sqlc.arg(display_name)
WHERE "id" = sqlc.arg(id) AND "household_id" = sqlc.arg(household_id)
RETURNING "id", "household_id", "provider_key", "display_name", "created_at";

-- name: DeleteProvider :execrows
-- Sender rules, messages and access grants cascade. The affected row count
-- distinguishes "deleted" from "no such provider in this household", which
-- the route answers with 404 rather than a silent 200.
DELETE FROM "providers"
WHERE "id" = $1 AND "household_id" = $2;

-- name: CountProvidersInHousehold :one
-- Backs the "do all of these providers belong to this household?" check the
-- invitation routes run before scoping an invite to them.
SELECT count(*) FROM "providers"
WHERE "household_id" = $1 AND "id" = ANY(sqlc.arg(provider_ids)::text[]);
