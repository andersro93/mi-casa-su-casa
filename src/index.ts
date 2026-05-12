import { Hono } from "hono";
import { cors } from "hono/cors";

import { authForEnv } from "./server/auth/auth";
import { loadAuthSession } from "./server/auth/middleware";
import { handleIncomingEmail } from "./server/email/handler";
import { purgeExpiredMessages } from "./server/jobs/retention";
import { adminRoutes } from "./server/routes/admin";
import { healthRoutes } from "./server/routes/health";
import { householdRoutes } from "./server/routes/households";
import { inboxRoutes } from "./server/routes/inbox";
import { invitationRoutes } from "./server/routes/invitations";
import { settingsRoutes } from "./server/routes/settings";
import { setupRoutes } from "./server/routes/setup";
import { createAppContext } from "./server/runtime/context";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/api/*",
  cors({
    origin: (origin) => origin ?? "http://localhost:8787",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.use("/api/inbox/*", loadAuthSession);
app.use("/api/admin/*", loadAuthSession);
app.use("/api/households/*", loadAuthSession);
app.use("/api/settings/*", loadAuthSession);

app.on(["GET", "POST"], "/api/auth/*", (c) =>
  authForEnv(c.env).handler(c.req.raw),
);
app.route("/api/health", healthRoutes);
app.route("/api/households", householdRoutes);
app.route("/api/inbox", inboxRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/invitations", invitationRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/setup", setupRoutes);

app.get("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

const worker: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async email(message, env, ctx) {
    const appContext = createAppContext(env, ctx);
    await handleIncomingEmail(message, appContext);
  },
  async scheduled(controller, env, ctx) {
    const appContext = createAppContext(env, ctx);
    await purgeExpiredMessages(appContext, controller.scheduledTime);
  },
};

export default worker;
