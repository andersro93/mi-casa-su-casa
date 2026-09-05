-- Queries over "household_invitations" and the provider scope an invitation
-- carries in "household_invitation_provider_access". Ports
-- src/server/db/repositories/invitations.ts (REF §A3, "Invitations").
--
-- Only the SHA-256 of the token is stored: the token itself lives in the
-- invite link and nowhere else, so a leaked database hands out no working
-- invitations.

-- name: InsertInvitation :exec
INSERT INTO "household_invitations" (
  "id", "household_id", "email", "name", "role", "token_hash", "status",
  "invited_by_user_id", "expires_at"
) VALUES (
  sqlc.arg(id), sqlc.arg(household_id), sqlc.arg(email), sqlc.arg(name), sqlc.arg(role),
  sqlc.arg(token_hash), 'pending', sqlc.arg(invited_by_user_id),
  sqlc.arg(expires_at)::timestamptz
);

-- name: InsertInvitationProvider :exec
INSERT INTO "household_invitation_provider_access" ("id", "invitation_id", "provider_id")
VALUES ($1, $2, $3);

-- name: ListInvitations :many
-- Newest first, one row per (invitation, scoped provider); an invitation
-- with no provider scope still appears once, with NULL provider columns,
-- which is what the LEFT JOINs are for. The caller groups the rows.
SELECT "household_invitations"."id",
       "household_invitations"."household_id",
       "household_invitations"."email",
       "household_invitations"."name",
       "household_invitations"."role",
       "household_invitations"."status",
       "household_invitations"."invited_by_user_id",
       "household_invitations"."accepted_by_user_id",
       "household_invitations"."expires_at",
       "household_invitations"."accepted_at",
       "household_invitations"."cancelled_at",
       "household_invitations"."created_at",
       "household_invitations"."updated_at",
       "providers"."id" AS "provider_id",
       "providers"."provider_key",
       "providers"."display_name" AS "provider_display_name"
FROM "household_invitations"
LEFT JOIN "household_invitation_provider_access"
  ON "household_invitation_provider_access"."invitation_id" = "household_invitations"."id"
LEFT JOIN "providers" ON "providers"."id" = "household_invitation_provider_access"."provider_id"
WHERE "household_invitations"."household_id" = $1
ORDER BY "household_invitations"."created_at" DESC;

-- name: GetInvitationByTokenHash :many
-- The public lookup: what the invite link resolves to. Not scoped by
-- household on purpose — the token *is* the credential, and the household it
-- names comes back in the row. token_hash is unique, so the several rows this
-- may return are one invitation's provider scope, never two invitations.
SELECT "household_invitations"."id",
       "household_invitations"."household_id",
       "household_invitations"."email",
       "household_invitations"."name",
       "household_invitations"."role",
       "household_invitations"."status",
       "household_invitations"."invited_by_user_id",
       "household_invitations"."accepted_by_user_id",
       "household_invitations"."expires_at",
       "household_invitations"."accepted_at",
       "household_invitations"."cancelled_at",
       "household_invitations"."created_at",
       "household_invitations"."updated_at",
       "providers"."id" AS "provider_id",
       "providers"."provider_key",
       "providers"."display_name" AS "provider_display_name"
FROM "household_invitations"
LEFT JOIN "household_invitation_provider_access"
  ON "household_invitation_provider_access"."invitation_id" = "household_invitations"."id"
LEFT JOIN "providers" ON "providers"."id" = "household_invitation_provider_access"."provider_id"
WHERE "household_invitations"."token_hash" = $1;

-- name: GetInvitationByID :many
SELECT "household_invitations"."id",
       "household_invitations"."household_id",
       "household_invitations"."email",
       "household_invitations"."name",
       "household_invitations"."role",
       "household_invitations"."status",
       "household_invitations"."invited_by_user_id",
       "household_invitations"."accepted_by_user_id",
       "household_invitations"."expires_at",
       "household_invitations"."accepted_at",
       "household_invitations"."cancelled_at",
       "household_invitations"."created_at",
       "household_invitations"."updated_at",
       "providers"."id" AS "provider_id",
       "providers"."provider_key",
       "providers"."display_name" AS "provider_display_name"
FROM "household_invitations"
LEFT JOIN "household_invitation_provider_access"
  ON "household_invitation_provider_access"."invitation_id" = "household_invitations"."id"
LEFT JOIN "providers" ON "providers"."id" = "household_invitation_provider_access"."provider_id"
WHERE "household_invitations"."id" = $1
  AND "household_invitations"."household_id" = $2;

-- name: CancelInvitation :exec
-- Scoped by household even though the caller has already looked the
-- invitation up through GetInvitationByID: an id is a UUID that may have been
-- learned elsewhere, and a write is the last place to start trusting one. The
-- TypeScript addressed this by id alone and relied on the route's earlier
-- check; carrying the predicate into the statement makes it structural.
UPDATE "household_invitations"
SET "status" = 'cancelled',
    "cancelled_at" = now(),
    "updated_at" = now()
WHERE "id" = sqlc.arg(id) AND "household_id" = sqlc.arg(household_id);

-- name: MarkInvitationAccepted :exec
-- Household-scoped for the same reason as CancelInvitation; the accept flow
-- resolved the household from the token in the same breath as the invitation,
-- so the predicate costs nothing.
UPDATE "household_invitations"
SET "status" = 'accepted',
    "accepted_by_user_id" = sqlc.arg(accepted_by_user_id),
    "accepted_at" = now(),
    "updated_at" = now()
WHERE "id" = sqlc.arg(id) AND "household_id" = sqlc.arg(household_id);

-- name: CopyInvitationProviderAccess :exec
-- Carries the invitation's provider scope over to the membership the accept
-- just created. Idempotent, so re-accepting an invitation (or retrying after
-- a failure) adds nothing twice.
--
-- The membership is joined on (household, user) rather than passed in as an
-- id: the accept upserts it in the same transaction, and looking it up here
-- means the copy cannot be pointed at some other household's membership.
--
-- The new rows' ids come from gen_random_uuid() rather than from the
-- application, the one place that happens: this is a set-valued INSERT whose
-- row count is only known to the database, so there is no id to mint in Go.
INSERT INTO "household_member_provider_access" ("id", "household_membership_id", "provider_id")
SELECT gen_random_uuid()::text,
       "household_memberships"."id",
       "household_invitation_provider_access"."provider_id"
FROM "household_invitation_provider_access"
INNER JOIN "household_memberships"
  ON "household_memberships"."household_id" = sqlc.arg(household_id)
 AND "household_memberships"."user_id" = sqlc.arg(accepted_by_user_id)
WHERE "household_invitation_provider_access"."invitation_id" = sqlc.arg(invitation_id)
ON CONFLICT ("household_membership_id", "provider_id") DO NOTHING;

-- name: RefreshExpiredInvitations :execrows
-- Flips pending invitations whose expiry has passed. The comparison is
-- against a caller-supplied timestamp, not now(), so the retention job and
-- the admin screens agree on one clock and a test can pin both sides.
--
-- household_id is optional: the invitations screen refreshes just its own
-- household before listing, while the nightly job sweeps them all.
--
-- :execrows rather than :exec because the retention job reports how many
-- invitations it expired (REF §A3's retention_completed sibling counts); the
-- admin screens ignore the number and only care that the sweep ran.
UPDATE "household_invitations"
SET "status" = 'expired',
    "updated_at" = now()
WHERE "status" = 'pending'
  AND "expires_at" <= sqlc.arg(now)::timestamptz
  AND (sqlc.narg(household_id)::text IS NULL OR "household_id" = sqlc.narg(household_id)::text);
