import { recordRetentionRun } from "../db/repositories/installation-state";
import { refreshExpiredInvitations } from "../db/repositories/invitations";
import { purgeExpired } from "../db/repositories/messages";
import type { AppContext } from "../runtime/context";
import { logEvent } from "../runtime/log";

/**
 * Daily retention job: purges expired inbox/quarantine messages in bounded
 * batches, expires pending invitations, and records the run so readiness can
 * report a stale cron. Failures are logged with context and re-thrown so the
 * run shows up as failed in Cron Triggers.
 */
export async function purgeExpiredMessages(
  appContext: AppContext,
  scheduledTime = Date.now(),
) {
  const startedAt = Date.now();
  const now = new Date(scheduledTime);
  const nowIso = now.toISOString();

  try {
    const purged = await purgeExpired(appContext.env.DB, nowIso);
    await refreshExpiredInvitations(appContext.env.DB, now);
    await recordRetentionRun(appContext.env.DB, nowIso);

    logEvent("info", "retention_completed", {
      scheduledFor: nowIso,
      messagesPurged: purged.messages,
      quarantinePurged: purged.quarantine,
      batches: purged.batches,
      durationMs: Date.now() - startedAt,
    });

    return purged;
  } catch (error) {
    logEvent("error", "retention_failed", {
      scheduledFor: nowIso,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
