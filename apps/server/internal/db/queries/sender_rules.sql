-- Queries over "sender_rules" — the rules that decide which provider an
-- inbound email belongs to. Ports the rule half of
-- src/server/db/repositories/provider-rules.ts (REF §A3, classification
-- step 4).

-- name: ListSenderRules :many
SELECT "id", "household_id", "provider_id", "match_type", "match_value", "created_at"
FROM "sender_rules"
WHERE "household_id" = $1
ORDER BY "created_at" ASC, "match_value" ASC;

-- name: GetSenderRuleByID :one
SELECT "id", "household_id", "provider_id", "match_type", "match_value", "created_at"
FROM "sender_rules"
WHERE "id" = $1 AND "household_id" = $2;

-- name: InsertSenderRule :one
-- A duplicate (household, match_type, match_value) raises 23505 on
-- sender_rules_household_match_unique, which the API turns into a 409 — one
-- address may not point at two providers within a household.
INSERT INTO "sender_rules" ("id", "household_id", "provider_id", "match_type", "match_value")
VALUES ($1, $2, $3, $4, $5)
RETURNING "id", "household_id", "provider_id", "match_type", "match_value", "created_at";

-- name: UpdateSenderRule :one
UPDATE "sender_rules"
SET "provider_id" = sqlc.arg(provider_id),
    "match_type" = sqlc.arg(match_type),
    "match_value" = sqlc.arg(match_value)
WHERE "id" = sqlc.arg(id) AND "household_id" = sqlc.arg(household_id)
RETURNING "id", "household_id", "provider_id", "match_type", "match_value", "created_at";

-- name: DeleteSenderRule :execrows
DELETE FROM "sender_rules"
WHERE "id" = $1 AND "household_id" = $2;

-- name: FindExactSenderRule :one
-- Classification step 4, first pass: an exact-address rule for this
-- household. The comparison lower-cases the stored value because the rule
-- was typed by a person and addresses are case-insensitive in practice; the
-- candidate arrives already trimmed and lower-cased.
SELECT "providers"."id" AS "provider_id",
       "providers"."provider_key",
       "providers"."household_id",
       "households"."slug" AS "household_slug"
FROM "sender_rules"
INNER JOIN "providers" ON "providers"."id" = "sender_rules"."provider_id"
INNER JOIN "households" ON "households"."id" = "providers"."household_id"
WHERE "sender_rules"."household_id" = sqlc.arg(household_id)
  AND "sender_rules"."match_type" = 'exact'
  AND lower("sender_rules"."match_value") = sqlc.arg(address)
LIMIT 1;

-- name: FindDomainSenderRule :one
-- Classification step 4, second pass: a domain rule matching the candidate's
-- domain itself or any subdomain of it ("netflix.com" matches
-- "em.netflix.com"). The most specific rule wins, which is what ordering by
-- the rule's length descending buys: with rules for both "netflix.com" and
-- "em.netflix.com", mail from em.netflix.com goes to the latter's provider.
--
-- The LIKE pattern is anchored with a leading '.' so "notnetflix.com" does
-- not match a "netflix.com" rule — a look-alike domain must not inherit
-- another sender's trust.
SELECT "providers"."id" AS "provider_id",
       "providers"."provider_key",
       "providers"."household_id",
       "households"."slug" AS "household_slug"
FROM "sender_rules"
INNER JOIN "providers" ON "providers"."id" = "sender_rules"."provider_id"
INNER JOIN "households" ON "households"."id" = "providers"."household_id"
WHERE "sender_rules"."household_id" = $1
  AND "sender_rules"."match_type" = 'domain'
  AND (
    lower("sender_rules"."match_value") = sqlc.arg(domain)
    OR sqlc.arg(domain)::text LIKE '%.' || lower("sender_rules"."match_value")
  )
ORDER BY length("sender_rules"."match_value") DESC
LIMIT 1;
