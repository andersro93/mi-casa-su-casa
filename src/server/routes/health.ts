import { Hono } from "hono";

import { validateEnv } from "../runtime/env";

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

    await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({
      status: "ready",
      setupConfigured: Boolean(c.env.OWNER_EMAIL && c.env.SETUP_SECRET),
    });
  });
