-- Queries over "messages" — the mail a sender rule matched. Ports the
-- matched half of src/server/db/repositories/messages.ts (REF, "Message
-- storage").
--
-- received_at and delete_after are always parameters computed from the
-- server's clock, never from the sender-controlled Date: header: a forged
-- header must not be able to reorder somebody's inbox or push a message past
-- its retention window.

-- name: InsertMessage :execrows
-- Idempotent on (household_id, message_id): the same broadcast may be
-- delivered twice, and the second delivery must be swallowed rather than
-- fail the ingest. The same Message-ID in a *different* household is a
-- different row, which is why the constraint is per household.
INSERT INTO "messages" (
  "id", "household_id", "message_id", "provider_id", "envelope_from", "envelope_to",
  "from_header", "subject", "text_body", "extracted_code", "classification_reason",
  "raw_size", "date_header", "received_at", "delete_after"
) VALUES (
  sqlc.arg(id), sqlc.arg(household_id), sqlc.arg(message_id), sqlc.arg(provider_id),
  sqlc.arg(envelope_from), sqlc.arg(envelope_to), sqlc.narg(from_header), sqlc.narg(subject),
  sqlc.arg(text_body), sqlc.narg(extracted_code), sqlc.arg(classification_reason),
  sqlc.arg(raw_size), sqlc.narg(date_header)::timestamptz,
  sqlc.arg(received_at)::timestamptz, sqlc.arg(delete_after)::timestamptz
)
ON CONFLICT ("household_id", "message_id") DO NOTHING;

-- name: InsertReleasedMessage :exec
-- The release half of a quarantine review: the quarantined row copied into
-- "messages" under the provider the owner picked, keeping the original
-- received_at and delete_after so releasing a message does not extend its
-- retention. ON CONFLICT DO NOTHING because the same Message-ID may already
-- have been stored (a redelivery classified after a rule change) — keeping
-- the existing row is right, and failing here would strand the quarantine
-- row unreviewed.
INSERT INTO "messages" (
  "id", "household_id", "message_id", "provider_id", "envelope_from", "envelope_to",
  "from_header", "subject", "text_body", "extracted_code", "status",
  "classification_reason", "raw_size", "date_header", "received_at", "delete_after"
)
SELECT sqlc.arg(id), "quarantine_messages"."household_id", "quarantine_messages"."message_id",
       sqlc.arg(provider_id), "quarantine_messages"."envelope_from", "quarantine_messages"."envelope_to",
       "quarantine_messages"."from_header", "quarantine_messages"."subject",
       "quarantine_messages"."text_body", "quarantine_messages"."extracted_code", 'new',
       'Released from quarantine by owner review. Original reason: ' || "quarantine_messages"."quarantine_reason",
       "quarantine_messages"."raw_size", "quarantine_messages"."date_header",
       "quarantine_messages"."received_at", "quarantine_messages"."delete_after"
FROM "quarantine_messages"
WHERE "quarantine_messages"."household_id" = sqlc.arg(household_id)
  AND "quarantine_messages"."id" = sqlc.arg(quarantine_id)
ON CONFLICT ("household_id", "message_id") DO NOTHING;

-- name: ListMessagesForProvider :many
-- One provider's inbox, newest first, with a keyset cursor. The caller asks
-- for limit+1 rows and uses the extra one to decide whether an older page
-- exists — cheaper and more stable under concurrent inserts than an OFFSET.
--
-- The id tiebreaker keeps the order total when two messages share a
-- received_at, so a cursor cannot skip or repeat a row.
SELECT "messages"."id",
       "households"."slug" AS "household_slug",
       "providers"."provider_key",
       "providers"."display_name" AS "provider_display_name",
       "messages"."subject",
       "messages"."from_header",
       "messages"."text_body",
       "messages"."extracted_code",
       "messages"."status",
       "messages"."received_at"
FROM "messages"
INNER JOIN "providers" ON "providers"."id" = "messages"."provider_id"
INNER JOIN "households" ON "households"."id" = "messages"."household_id"
WHERE "messages"."household_id" = sqlc.arg(household_id)
  AND "providers"."provider_key" = sqlc.arg(provider_key)
  AND (sqlc.narg(before)::timestamptz IS NULL OR "messages"."received_at" < sqlc.narg(before)::timestamptz)
ORDER BY "messages"."received_at" DESC, "messages"."id" DESC
LIMIT sqlc.arg(row_limit);

-- name: FindMessageByID :one
SELECT "messages"."id",
       "households"."slug" AS "household_slug",
       "providers"."provider_key",
       "providers"."display_name" AS "provider_display_name",
       "messages"."subject",
       "messages"."from_header",
       "messages"."text_body",
       "messages"."extracted_code",
       "messages"."status",
       "messages"."received_at"
FROM "messages"
INNER JOIN "providers" ON "providers"."id" = "messages"."provider_id"
INNER JOIN "households" ON "households"."id" = "messages"."household_id"
WHERE "messages"."household_id" = sqlc.arg(household_id)
  AND "messages"."id" = sqlc.arg(id);

-- name: FindMessageByMessageID :one
-- The released copy, looked up the way the review response needs it: by
-- (household, Message-ID), newest first, because ON CONFLICT DO NOTHING may
-- have kept an older row with the same Message-ID instead of inserting ours.
SELECT "messages"."id",
       "households"."slug" AS "household_slug",
       "providers"."provider_key",
       "providers"."display_name" AS "provider_display_name",
       "messages"."subject",
       "messages"."from_header",
       "messages"."text_body",
       "messages"."extracted_code",
       "messages"."status",
       "messages"."received_at"
FROM "messages"
INNER JOIN "providers" ON "providers"."id" = "messages"."provider_id"
INNER JOIN "households" ON "households"."id" = "messages"."household_id"
WHERE "messages"."household_id" = sqlc.arg(household_id)
  AND "messages"."message_id" = sqlc.arg(message_id)
ORDER BY "messages"."created_at" DESC
LIMIT 1;

-- name: UpdateMessageStatus :exec
UPDATE "messages"
SET "status" = sqlc.arg(status)
WHERE "household_id" = sqlc.arg(household_id) AND "id" = sqlc.arg(id);

-- name: ListProviderSummariesForUser :many
-- The inbox landing page: every provider this user may see, with its message
-- counts and a preview of the newest message so the common case (read the
-- latest code) needs no second request.
--
-- The membership join is what scopes it to the user: an owner sees every
-- provider (the role test), a member only those with an access grant (the
-- LEFT JOIN test), and a non-member gets no rows at all because the INNER
-- JOIN on their membership finds nothing.
SELECT "households"."slug" AS "household_slug",
       "providers"."provider_key",
       "providers"."display_name",
       count("messages"."id")::bigint AS "message_count",
       COALESCE(sum(CASE WHEN "messages"."status" = 'new' THEN 1 ELSE 0 END), 0)::bigint AS "new_count",
       max("messages"."received_at")::timestamptz AS "latest_received_at",
       "latest"."id" AS "latest_message_id",
       "latest"."subject" AS "latest_subject",
       "latest"."extracted_code" AS "latest_code",
       "latest"."status" AS "latest_status"
FROM "providers"
INNER JOIN "households" ON "households"."id" = "providers"."household_id"
INNER JOIN "household_memberships"
  ON "household_memberships"."household_id" = "providers"."household_id"
 AND "household_memberships"."user_id" = sqlc.arg(user_id)
LEFT JOIN "household_member_provider_access"
  ON "household_member_provider_access"."household_membership_id" = "household_memberships"."id"
 AND "household_member_provider_access"."provider_id" = "providers"."id"
LEFT JOIN "messages"
  ON "messages"."provider_id" = "providers"."id"
 AND "messages"."household_id" = "providers"."household_id"
LEFT JOIN "messages" AS "latest"
  ON "latest"."id" = (
    SELECT "newest"."id" FROM "messages" AS "newest"
    WHERE "newest"."provider_id" = "providers"."id"
      AND "newest"."household_id" = "providers"."household_id"
    ORDER BY "newest"."received_at" DESC, "newest"."id" DESC
    LIMIT 1
  )
WHERE "providers"."household_id" = sqlc.arg(household_id)
  AND ("household_memberships"."role" = 'owner' OR "household_member_provider_access"."id" IS NOT NULL)
GROUP BY "households"."slug", "providers"."id", "providers"."provider_key", "providers"."display_name",
         "providers"."created_at", "latest"."id", "latest"."subject", "latest"."extracted_code",
         "latest"."status"
ORDER BY COALESCE(max("messages"."received_at"), "providers"."created_at") DESC,
         "providers"."display_name" ASC;

-- name: PurgeMessages :execrows
-- One bounded batch of the retention sweep. The bound keeps each statement's
-- lock footprint small even after a long cron outage, so a catch-up run does
-- not block ingest for minutes.
--
-- Postgres has no rowid, so the subselect addresses rows by ctid — the
-- physical row pointer, which is stable for the life of a statement and is
-- exactly what a "delete these N rows, whichever they are" batch needs.
DELETE FROM "messages"
WHERE "ctid" IN (
  SELECT "ctid" FROM "messages"
  WHERE "delete_after" <= sqlc.arg(now)::timestamptz
  LIMIT sqlc.arg(batch_size)
);
