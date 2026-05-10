import { Hono } from "hono";

import {
  type AppVariables,
  requireAuthenticatedUser,
  requireOwner,
} from "../auth/middleware";
import {
  listMessagesForProvider,
  listQuarantineMessages,
} from "../db/repositories/messages";
import { userHasProviderAccess } from "../db/repositories/provider-rules";

export const inboxRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

inboxRoutes.use("/providers/:providerKey", requireAuthenticatedUser);
inboxRoutes.use("/quarantine", requireOwner);

inboxRoutes.get("/providers/:providerKey", async (c) => {
  const providerKey = c.req.param("providerKey");
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (user.role !== "admin") {
    const allowed = await userHasProviderAccess(c.env.DB, user.id, providerKey);
    if (!allowed) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  const messages = await listMessagesForProvider(c.env.DB, providerKey);
  return c.json({ messages });
});

inboxRoutes.get("/quarantine", async (c) => {
  const messages = await listQuarantineMessages(c.env.DB);
  return c.json({ messages });
});
