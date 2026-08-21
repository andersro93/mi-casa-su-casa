import { Hono } from "hono";
import {
  type AppVariables,
  requireAuthenticatedUser,
  requireHouseholdContext,
  requireOwner,
} from "../auth/middleware";
import { recordAuditEvent } from "../db/repositories/audit";
import {
  findMessageById,
  listMessagesForProvider,
  listProviderSummariesForUser,
  listQuarantineMessages,
  normalizePageOptions,
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

inboxRoutes.use("/:slug/*", requireAuthenticatedUser);
inboxRoutes.use("/:slug/*", requireHouseholdContext);
inboxRoutes.use("/:slug/quarantine", requireOwner);
inboxRoutes.use("/:slug/quarantine/:messageId/review", requireOwner);

inboxRoutes.get("/:slug/providers", async (c) => {
  const user = c.get("user");
  const household = c.get("household");

  if (!user || !household) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const providers = await listProviderSummariesForUser(
    c.env.DB,
    household.id,
    user.id,
  );
  return c.json({ providers });
});

inboxRoutes.get("/:slug/providers/:providerKey", async (c) => {
  const providerKey = c.req.param("providerKey");
  const user = c.get("user");
  const household = c.get("household");

  if (!user || !household) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (household.role !== "owner") {
    const allowed = await userHasProviderAccess(
      c.env.DB,
      household.id,
      user.id,
      providerKey,
    );
    if (!allowed) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  const provider = await getProviderByKey(c.env.DB, household.id, providerKey);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const page = normalizePageOptions({
    limit: Number(c.req.query("limit") ?? Number.NaN),
    before: c.req.query("before") ?? null,
  });
  const result = await listMessagesForProvider(
    c.env.DB,
    household.id,
    providerKey,
    page,
  );
  return c.json({
    provider: {
      providerKey: provider.provider_key,
      displayName: provider.display_name,
    },
    messages: result.items,
    page: { limit: page.limit, nextBefore: result.nextBefore },
  });
});

inboxRoutes.patch("/:slug/messages/:messageId/status", async (c) => {
  const user = c.get("user");
  const household = c.get("household");
  const messageId = c.req.param("messageId");

  if (!user || !household) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const existingMessage = await findMessageById(
    c.env.DB,
    household.id,
    messageId,
  );

  if (!existingMessage) {
    return c.json({ error: "Message not found" }, 404);
  }

  if (household.role !== "owner") {
    const allowed = await userHasProviderAccess(
      c.env.DB,
      household.id,
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
    household.id,
    messageId,
    payload.status,
  );

  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  return c.json({ message });
});

inboxRoutes.get("/:slug/quarantine", async (c) => {
  const household = c.get("household");

  if (!household) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const page = normalizePageOptions({
    limit: Number(c.req.query("limit") ?? Number.NaN),
    before: c.req.query("before") ?? null,
  });
  const result = await listQuarantineMessages(c.env.DB, household.id, page);
  return c.json({
    messages: result.items,
    page: { limit: page.limit, nextBefore: result.nextBefore },
  });
});

inboxRoutes.post("/:slug/quarantine/:messageId/review", async (c) => {
  const household = c.get("household");
  const messageId = c.req.param("messageId");

  if (!household) {
    return c.json({ error: "Forbidden" }, 403);
  }

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

    const provider = await getProviderByKey(
      c.env.DB,
      household.id,
      payload.providerKey,
    );

    if (!provider) {
      return c.json({ error: "Provider not found" }, 404);
    }

    providerId = provider.id;
  }

  const result = await reviewQuarantineMessage(
    c.env.DB,
    household.id,
    messageId,
    {
      action: payload.action,
      providerId,
    },
  );

  if (!result) {
    return c.json({ error: "Quarantine message not found" }, 404);
  }

  await recordAuditEvent(c.env.DB, {
    actorUserId: c.get("user")?.id ?? null,
    householdId: household.id,
    action: `quarantine.${payload.action}`,
    targetType: "quarantine_message",
    targetId: messageId,
    details: payload.providerKey
      ? { providerKey: payload.providerKey }
      : undefined,
  });

  return c.json(result);
});
