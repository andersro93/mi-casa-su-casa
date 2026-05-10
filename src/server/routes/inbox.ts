import { Hono } from "hono";

import {
  type AppVariables,
  requireAuthenticatedUser,
  requireOwner,
} from "../auth/middleware";
import {
  findMessageById,
  listMessagesForProvider,
  listProviderSummariesForUser,
  listQuarantineMessages,
  reviewQuarantineMessage,
  updateMessageStatus,
} from "../db/repositories/messages";
import {
  getProviderByKey,
  userHasProviderAccess,
} from "../db/repositories/provider-rules";

const VALID_MESSAGE_STATUSES = new Set(["new", "used", "expired"]);

function isValidMessageStatus(
  status: string,
): status is "new" | "used" | "expired" {
  return VALID_MESSAGE_STATUSES.has(status);
}

export const inboxRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

inboxRoutes.use("/providers", requireAuthenticatedUser);
inboxRoutes.use("/providers/:providerKey", requireAuthenticatedUser);
inboxRoutes.use("/messages/:messageId/status", requireAuthenticatedUser);
inboxRoutes.use("/quarantine", requireOwner);
inboxRoutes.use("/quarantine/:messageId/review", requireOwner);

inboxRoutes.get("/providers", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const providers = await listProviderSummariesForUser(
    c.env.DB,
    user.id,
    user.role,
  );
  return c.json({ providers });
});

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

  const provider = await getProviderByKey(c.env.DB, providerKey);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const messages = await listMessagesForProvider(c.env.DB, providerKey);
  return c.json({
    provider: {
      providerKey: provider.provider_key,
      displayName: provider.display_name,
    },
    messages,
  });
});

inboxRoutes.patch("/messages/:messageId/status", async (c) => {
  const user = c.get("user");
  const messageId = c.req.param("messageId");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const existingMessage = await findMessageById(c.env.DB, messageId);

  if (!existingMessage) {
    return c.json({ error: "Message not found" }, 404);
  }

  if (user.role !== "admin") {
    const allowed = await userHasProviderAccess(
      c.env.DB,
      user.id,
      existingMessage.provider_key,
    );

    if (!allowed) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  let payload: { status?: string };

  try {
    payload = await c.req.json<{ status?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.status || !isValidMessageStatus(payload.status)) {
    return c.json({ error: "Invalid message status" }, 400);
  }

  const message = await updateMessageStatus(
    c.env.DB,
    messageId,
    payload.status,
  );

  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({ message });
});

inboxRoutes.get("/quarantine", async (c) => {
  const messages = await listQuarantineMessages(c.env.DB);
  return c.json({ messages });
});

inboxRoutes.post("/quarantine/:messageId/review", async (c) => {
  const messageId = c.req.param("messageId");

  let payload: { action?: "dismiss" | "release"; providerKey?: string };

  try {
    payload = await c.req.json<{
      action?: "dismiss" | "release";
      providerKey?: string;
    }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (payload.action !== "dismiss" && payload.action !== "release") {
    return c.json({ error: "Invalid review action" }, 400);
  }

  let providerId: string | undefined;

  if (payload.action === "release") {
    if (!payload.providerKey) {
      return c.json(
        { error: "providerKey is required to release a message" },
        400,
      );
    }

    const provider = await getProviderByKey(c.env.DB, payload.providerKey);

    if (!provider) {
      return c.json({ error: "Provider not found" }, 404);
    }

    providerId = provider.id;
  }

  const result = await reviewQuarantineMessage(c.env.DB, messageId, {
    action: payload.action,
    providerId,
  });

  if (!result) {
    return c.json({ error: "Quarantine message not found" }, 404);
  }

  return c.json(result);
});
