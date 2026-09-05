-- Queries over "quarantine_messages" — the mail no sender rule matched, or
-- whose sender failed authentication. Ports the quarantine half of
-- src/server/db/repositories/messages.ts.
--
-- There is no provider_id here by design: quarantine is precisely the mail
-- that could not be attributed to a provider. An owner decides, from the
-- needs-review queue, whether it becomes a message (release) or nothing
-- (dismiss).

-- name: InsertQuarantineMessage :execrows
-- Idempotent on (household_id, message_id), same reasoning as InsertMessage.
INSERT INTO "quarantine_messages" (
  "id", "household_id", "message_id", "envelope_from", "envelope_to", "from_header",
  "subject", "text_body", "extracted_code", "quarantine_reason", "raw_size",
  "date_header", "received_at", "delete_after"
) VALUES (
  sqlc.arg(id), sqlc.arg(household_id), sqlc.arg(message_id), sqlc.arg(envelope_from),
  sqlc.arg(envelope_to), sqlc.narg(from_header), sqlc.narg(subject), sqlc.arg(text_body),
  sqlc.narg(extracted_code), sqlc.arg(quarantine_reason), sqlc.arg(raw_size),
  sqlc.narg(date_header)::timestamptz, sqlc.arg(received_at)::timestamptz,
  sqlc.arg(delete_after)::timestamptz
)
ON CONFLICT ("household_id", "message_id") DO NOTHING;

-- name: CountUnreviewedQuarantine :one
-- Feeds both the needs-review badge and the ingest guard that rejects new
-- mail once a mailbox's queue reaches 200 unreviewed rows.
SELECT count(*) FROM "quarantine_messages"
WHERE "household_id" = $1 AND "reviewed_at" IS NULL;

-- name: ListQuarantineMessages :many
-- The needs-review queue: unreviewed rows only, newest first, keyset-paged
-- like the inbox. provider_key and provider_display_name are literals so the
-- SPA can render a quarantine row with the same component as an inbox row.
SELECT "quarantine_messages"."id",
       "households"."slug" AS "household_slug",
       'quarantine'::text AS "provider_key",
       'Quarantine'::text AS "provider_display_name",
       "quarantine_messages"."subject",
       "quarantine_messages"."from_header",
       "quarantine_messages"."envelope_from",
       "quarantine_messages"."text_body",
       "quarantine_messages"."extracted_code",
       'new'::text AS "status",
       "quarantine_messages"."quarantine_reason",
       "quarantine_messages"."received_at"
FROM "quarantine_messages"
INNER JOIN "households" ON "households"."id" = "quarantine_messages"."household_id"
WHERE "quarantine_messages"."household_id" = sqlc.arg(household_id)
  AND "quarantine_messages"."reviewed_at" IS NULL
  AND (sqlc.narg(before)::timestamptz IS NULL
       OR "quarantine_messages"."received_at" < sqlc.narg(before)::timestamptz)
ORDER BY "quarantine_messages"."received_at" DESC, "quarantine_messages"."id" DESC
LIMIT sqlc.arg(row_limit);

-- name: GetQuarantineMessage :one
-- The full row a review works from, including reviewed_at: a row already
-- reviewed must not be reviewed twice (the second review would insert a
-- second copy of the released message).
SELECT "id", "household_id", "message_id", "envelope_from", "envelope_to", "from_header",
       "subject", "text_body", "extracted_code", "quarantine_reason", "raw_size",
       "date_header", "received_at", "delete_after", "reviewed_at"
FROM "quarantine_messages"
WHERE "household_id" = $1 AND "id" = $2;

-- name: MarkQuarantineReviewed :exec
UPDATE "quarantine_messages"
SET "reviewed_at" = sqlc.arg(reviewed_at)::timestamptz
WHERE "household_id" = sqlc.arg(household_id) AND "id" = sqlc.arg(id);

-- name: PurgeQuarantineMessages :execrows
-- The quarantine half of the retention sweep; see PurgeMessages for why the
-- batch addresses rows by ctid.
DELETE FROM "quarantine_messages"
WHERE "ctid" IN (
  SELECT "ctid" FROM "quarantine_messages"
  WHERE "delete_after" <= sqlc.arg(now)::timestamptz
  LIMIT sqlc.arg(batch_size)
);
