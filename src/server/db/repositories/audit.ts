import { desc, eq, sql } from "drizzle-orm";
import { logEvent } from "../../runtime/log";
import { dbForDatabase } from "../client";
import { auditEvents } from "../schema";

export type AuditEventInput = {
  actorUserId: string | null;
  householdId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Records who did what. Failures are logged, never thrown: an audit hiccup
 * must not undo or hide the action the user just performed.
 */
export async function recordAuditEvent(
  db: D1Database,
  input: AuditEventInput,
): Promise<void> {
  try {
    await dbForDatabase(db)
      .insert(auditEvents)
      .values({
        id: crypto.randomUUID(),
        actorUserId: input.actorUserId,
        householdId: input.householdId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        detailsJson: input.details ? JSON.stringify(input.details) : null,
        createdAt: sql`CURRENT_TIMESTAMP`,
      });
  } catch (error) {
    logEvent("error", "audit_write_failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type AuditEventRecord = {
  id: string;
  actorUserId: string | null;
  householdId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export async function listAuditEvents(
  db: D1Database,
  householdId: string,
  limit = 100,
): Promise<AuditEventRecord[]> {
  const rows = await dbForDatabase(db)
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.householdId, householdId))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actorUserId,
    householdId: row.householdId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    details: row.detailsJson
      ? (JSON.parse(row.detailsJson) as Record<string, unknown>)
      : null,
    createdAt: row.createdAt,
  }));
}
