import { Hono } from "hono";

import { getInstallationState } from "../db/repositories/installation-state";
import { validateEnv } from "../runtime/env";

/** The cron runs daily; anything older than this is worth an alert. */
export const RETENTION_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export const healthRoutes = new Hono<{ Bindings: Env }>()
  .get("/live", (c) => c.json({ status: "ok" }))
  .get("/ready", async (c) => {
    const validation = validateEnv(c.env);

    if (!validation.ok) {
      return c.json(
        { status: "misconfigured", problems: validation.problems },
        503,
      );
    }

    const state = await getInstallationState(c.env.DB);
    const lastRetentionRunAt = state.last_retention_run_at;
    const lastRun = lastRetentionRunAt ? Date.parse(lastRetentionRunAt) : NaN;
    const retentionStale =
      Number.isNaN(lastRun) || Date.now() - lastRun > RETENTION_STALE_AFTER_MS;

    return c.json({
      status: "ready",
      setupConfigured: Boolean(c.env.OWNER_EMAIL && c.env.SETUP_SECRET),
      retention: {
        lastRunAt: lastRetentionRunAt,
        // True until the first run and whenever the cron has not completed
        // within the last 48 hours — an external monitor can alert on it.
        stale: retentionStale,
      },
    });
  });
