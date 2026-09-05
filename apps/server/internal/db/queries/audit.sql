-- Queries over "audit_events" — who did what (REF §A6). Ports
-- src/server/db/repositories/audit.ts.
--
-- The table has no foreign keys: the trail has to outlive both the actor and
-- the household it describes, and a cascade would quietly erase exactly the
-- record of a deletion someone later wants to look up. Installation-level
-- events leave household_id NULL and therefore never appear in a household's
-- log.

-- name: InsertAuditEvent :exec
INSERT INTO "audit_events" (
  "id", "actor_user_id", "household_id", "action", "target_type", "target_id", "details"
) VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: ListAuditEvents :many
-- Newest first, with the id as a tiebreaker so two events written in the same
-- transaction (and therefore sharing now()) still come back in a stable
-- order.
SELECT "id", "actor_user_id", "household_id", "action", "target_type", "target_id",
       "details", "created_at"
FROM "audit_events"
WHERE "household_id" = $1
ORDER BY "created_at" DESC, "id" DESC
LIMIT sqlc.arg(row_limit);
