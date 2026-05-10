import { Hono } from "hono";

export const healthRoutes = new Hono<{ Bindings: Env }>()
  .get("/live", (c) => c.json({ status: "ok" }))
  .get("/ready", async (c) => {
    await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ status: "ready" });
  });
