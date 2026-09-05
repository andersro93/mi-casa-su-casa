-- Queries over "household_memberships" and the per-member provider scope in
-- "household_member_provider_access". Ports the membership half of
-- src/server/db/repositories/households.ts and all of
-- src/server/db/repositories/member-access.ts.
--
-- Every statement carries the household_id, including the ones that already
-- look unambiguous from a user id: a membership is only ever addressed as
-- (household, user), which is also the pair the unique constraint is on.

-- name: InsertMembership :exec
INSERT INTO "household_memberships" ("id", "household_id", "user_id", "role")
VALUES ($1, $2, $3, $4);

-- name: UpsertMembership :exec
-- Accepting an invitation twice, or accepting one that grants a higher role
-- than the membership already held, must not fail: the second accept
-- upgrades the role instead of colliding with the (household, user) unique
-- constraint.
INSERT INTO "household_memberships" ("id", "household_id", "user_id", "role")
VALUES ($1, $2, $3, $4)
ON CONFLICT ("household_id", "user_id") DO UPDATE
SET "role" = EXCLUDED."role",
    "updated_at" = now();

-- name: MembershipForSlug :one
-- The tenancy check every :slug route runs first: is this user a member of
-- the household this URL names, and in what role?
SELECT "household_memberships"."household_id",
       "households"."slug",
       "household_memberships"."role"
FROM "household_memberships"
INNER JOIN "households" ON "households"."id" = "household_memberships"."household_id"
WHERE "household_memberships"."user_id" = $1
  AND "households"."slug" = $2;

-- name: GetMembership :one
SELECT "household_memberships"."household_id",
       "households"."slug",
       "household_memberships"."role"
FROM "household_memberships"
INNER JOIN "households" ON "households"."id" = "household_memberships"."household_id"
WHERE "household_memberships"."user_id" = $1
  AND "household_memberships"."household_id" = $2;

-- name: CountHouseholdOwners :one
-- Guards the last-owner rules: a household must keep at least one owner, so
-- leaving and member removal both count first.
SELECT count(*) FROM "household_memberships"
WHERE "household_id" = $1 AND "role" = 'owner';

-- name: DeleteMembership :exec
-- Provider access rows cascade (household_member_provider_access references
-- the membership ON DELETE CASCADE), so removing a member also removes what
-- they could see.
DELETE FROM "household_memberships"
WHERE "household_id" = $1 AND "user_id" = $2;

-- name: SetMembershipRole :exec
UPDATE "household_memberships"
SET "role" = $3,
    "updated_at" = now()
WHERE "household_id" = $1 AND "user_id" = $2;

-- name: ListMembers :many
-- The members screen. Ordered by the user's created_at so the list is stable
-- as roles change, exactly as the TypeScript ordered it.
SELECT "users"."id",
       "household_memberships"."role" AS "household_role",
       "users"."email",
       "users"."name",
       "users"."created_at",
       "users"."updated_at"
FROM "household_memberships"
INNER JOIN "users" ON "users"."id" = "household_memberships"."user_id"
WHERE "household_memberships"."household_id" = $1
ORDER BY "users"."created_at" ASC;

-- name: ListMemberProviderAccess :many
-- One row per (member, provider they may see); a member with no provider
-- scope still appears once with NULL provider columns, which is what the
-- LEFT JOINs are for — the members screen lists every member, granted access
-- or not.
SELECT "users"."id",
       "household_memberships"."role" AS "household_role",
       "users"."email",
       "users"."name",
       "providers"."provider_key",
       "providers"."display_name" AS "provider_display_name"
FROM "household_memberships"
INNER JOIN "users" ON "users"."id" = "household_memberships"."user_id"
LEFT JOIN "household_member_provider_access"
  ON "household_member_provider_access"."household_membership_id" = "household_memberships"."id"
LEFT JOIN "providers" ON "providers"."id" = "household_member_provider_access"."provider_id"
WHERE "household_memberships"."household_id" = $1
ORDER BY "users"."created_at" ASC, "providers"."display_name" ASC;

-- name: GrantProviderAccess :exec
-- Idempotent, and safe against a provider id from another household: the
-- INSERT ... SELECT only produces a row when the membership and the provider
-- belong to the *same* household, so a cross-tenant grant silently inserts
-- nothing instead of wiring one household's member to another's provider.
INSERT INTO "household_member_provider_access" ("id", "household_membership_id", "provider_id")
SELECT sqlc.arg(id), "household_memberships"."id", "providers"."id"
FROM "household_memberships"
INNER JOIN "providers"
  ON "providers"."id" = sqlc.arg(provider_id)
 AND "providers"."household_id" = "household_memberships"."household_id"
WHERE "household_memberships"."household_id" = sqlc.arg(household_id)
  AND "household_memberships"."user_id" = sqlc.arg(user_id)
ON CONFLICT ("household_membership_id", "provider_id") DO NOTHING;

-- name: RevokeProviderAccess :exec
DELETE FROM "household_member_provider_access"
WHERE "provider_id" = sqlc.arg(provider_id)
  AND "household_membership_id" IN (
    SELECT "id" FROM "household_memberships"
    WHERE "household_id" = sqlc.arg(household_id) AND "user_id" = sqlc.arg(user_id)
  );

-- name: UserHasProviderAccess :one
-- Whether a member may read a provider's mail. Owners bypass this check in
-- the route layer (they see everything); members need an explicit grant.
SELECT EXISTS (
  SELECT 1
  FROM "household_memberships"
  INNER JOIN "household_member_provider_access"
    ON "household_member_provider_access"."household_membership_id" = "household_memberships"."id"
  INNER JOIN "providers" ON "providers"."id" = "household_member_provider_access"."provider_id"
  WHERE "household_memberships"."household_id" = $1
    AND "household_memberships"."user_id" = $2
    AND "providers"."provider_key" = $3
);
