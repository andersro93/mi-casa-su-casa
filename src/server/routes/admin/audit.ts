import { recordAuditEvent } from "../../db/repositories/audit";

type AuditContext = {
  env: Env;
  get: ((key: "user") => { id: string } | null) &
    ((key: "household") => { id: string } | null);
};

/** Records an owner/admin action against the current household. */
export function audit(
  c: AuditContext,
  action: string,
  targetType: string,
  targetId: string | null,
  details?: Record<string, unknown>,
) {
  return recordAuditEvent(c.env.DB, {
    actorUserId: c.get("user")?.id ?? null,
    householdId: c.get("household")?.id ?? null,
    action,
    targetType,
    targetId,
    details,
  });
}
