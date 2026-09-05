-- Queries over the singleton "app_installation" row (id = 1): the first-run
-- setup state machine (pending → in_progress → complete) and the retention
-- cron's last-success stamp.
--
-- Every statement pins "id" = 1 rather than trusting a caller-supplied id.
-- The table's CHECK already forbids any other row, so an id parameter could
-- only ever be 1 — spelling it out here keeps the impossible case out of the
-- call sites entirely.

-- name: GetInstallation :one
SELECT * FROM "app_installation" WHERE "id" = 1;

-- name: EnsureInstallation :exec
-- Belt-and-braces companion to the migration's own seed INSERT, run at boot:
-- a database restored from a partial dump, or one whose row someone deleted
-- by hand, still comes up in 'pending' instead of failing every setup read
-- with "no rows".
INSERT INTO "app_installation" ("id", "status")
VALUES (1, 'pending')
ON CONFLICT ("id") DO NOTHING;

-- name: BeginInstallationSetup :execrows
-- Claims the setup flow for this request. Returning the affected row count
-- makes the claim a genuine mutual exclusion: two concurrent first-run
-- requests both run this UPDATE, but only one of them matches the WHERE and
-- sees 1 row — the loser sees 0 and is told setup is already under way.
--
-- The second branch is the recovery path. A setup attempt that crashed
-- between claiming and completing would otherwise leave the installation
-- wedged in 'in_progress' forever, with no way in but a manual UPDATE; a
-- claim older than the caller-supplied stale_before is treated as abandoned
-- and may be taken over. stale_before is a parameter rather than
-- now() - interval '...' so the timeout stays a decision of the caller's
-- (testable) clock, not of this file.
UPDATE "app_installation"
SET "status" = 'in_progress',
    "updated_at" = now()
WHERE "id" = 1
  AND (
    "status" = 'pending'
    OR ("status" = 'in_progress' AND "updated_at" < sqlc.arg(stale_before)::timestamptz)
  );

-- name: CompleteInstallationSetup :exec
-- Records the owner the first-run flow created and closes the state machine.
-- The email is denormalised alongside owner_user_id so the installation's
-- contact address survives the owner's account being deleted.
UPDATE "app_installation"
SET "status" = 'complete',
    "owner_user_id" = sqlc.arg(owner_user_id),
    "owner_email" = sqlc.arg(owner_email),
    "completed_at" = now(),
    "updated_at" = now()
WHERE "id" = 1;

-- name: ResetInstallationSetup :exec
-- Releases a claim that did not produce an owner — the rollback half of
-- BeginInstallationSetup, for a setup attempt that failed after claiming.
-- The owner_user_id IS NULL guard is what makes it safe to call from an
-- error path: an installation that did get an owner is never dragged back to
-- 'pending', which would re-open first-run setup on a live system and hand
-- the next visitor an owner account.
UPDATE "app_installation"
SET "status" = 'pending',
    "updated_at" = now()
WHERE "id" = 1
  AND "status" = 'in_progress'
  AND "owner_user_id" IS NULL;

-- name: RecordRetentionRun :exec
-- Stamped by the retention job on success only, so readiness can distinguish
-- "the cron is running" from "the cron has been silently failing for weeks".
UPDATE "app_installation"
SET "last_retention_run_at" = now(),
    "updated_at" = now()
WHERE "id" = 1;
