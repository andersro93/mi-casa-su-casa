import { Hono } from "hono";

import type { AppVariables } from "../../auth/middleware";
import {
  createProvider,
  createSenderRule,
  deleteProvider,
  deleteSenderRule,
  getProviderById,
  getProviderByKey,
  getSenderRuleById,
  listProviderConfigurations,
  listSenderRules,
  updateProvider,
  updateSenderRule,
} from "../../db/repositories/provider-rules";
import { providerSchema, senderRuleSchema } from "../../http/schemas";
import { parseJsonBody } from "../../http/validation";
import { audit } from "./audit";

export const providersRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

providersRoutes.get("/:slug/providers", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const [providers, rules] = await Promise.all([
    listProviderConfigurations(c.env.DB, household.id),
    listSenderRules(c.env.DB, household.id),
  ]);

  return c.json({
    providers,
    rules,
  });
});

providersRoutes.post("/:slug/providers", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const body = await parseJsonBody(c, providerSchema);
  if (!body.ok) return body.response;
  const { providerKey, displayName } = body.data;

  const existing = await getProviderByKey(c.env.DB, household.id, providerKey);

  if (existing) {
    return c.json({ error: "Provider key already exists" }, 409);
  }

  const provider = await createProvider(
    c.env.DB,
    household.id,
    providerKey,
    displayName,
  );

  await audit(c, "provider.created", "provider", provider.id, {
    providerKey,
    displayName,
  });
  return c.json({ provider }, 201);
});

providersRoutes.patch("/:slug/providers/:providerId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const body = await parseJsonBody(c, providerSchema);
  if (!body.ok) return body.response;
  const providerId = c.req.param("providerId");
  const { providerKey, displayName } = body.data;

  const existing = await getProviderById(c.env.DB, household.id, providerId);

  if (!existing) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const conflict = await getProviderByKey(c.env.DB, household.id, providerKey);

  if (conflict && conflict.id !== providerId) {
    return c.json({ error: "Provider key already exists" }, 409);
  }

  await updateProvider(
    c.env.DB,
    household.id,
    providerId,
    providerKey,
    displayName,
  );

  const provider = await getProviderById(c.env.DB, household.id, providerId);

  await audit(c, "provider.updated", "provider", providerId, {
    providerKey,
    displayName,
  });
  return c.json({ provider });
});

providersRoutes.delete("/:slug/providers/:providerId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const providerId = c.req.param("providerId");
  const provider = await getProviderById(c.env.DB, household.id, providerId);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  await deleteProvider(c.env.DB, household.id, providerId);
  await audit(c, "provider.deleted", "provider", providerId);

  return c.json({ ok: true });
});

providersRoutes.post("/:slug/provider-rules", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const body = await parseJsonBody(c, senderRuleSchema);
  if (!body.ok) return body.response;
  const payload = body.data;
  const matchValue = payload.matchValue;

  const provider = await getProviderById(
    c.env.DB,
    household.id,
    payload.providerId,
  );

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const rule = await createSenderRule(
    c.env.DB,
    household.id,
    payload.providerId,
    payload.matchType,
    matchValue,
  );

  await audit(c, "sender_rule.created", "sender_rule", rule.id, {
    providerId: payload.providerId,
    matchType: payload.matchType,
    matchValue,
  });
  return c.json({ rule }, 201);
});

providersRoutes.patch("/:slug/provider-rules/:ruleId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const body = await parseJsonBody(c, senderRuleSchema);
  if (!body.ok) return body.response;
  const payload = body.data;
  const ruleId = c.req.param("ruleId");
  const matchValue = payload.matchValue;

  const [provider, existingRule] = await Promise.all([
    getProviderById(c.env.DB, household.id, payload.providerId),
    getSenderRuleById(c.env.DB, household.id, ruleId),
  ]);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  if (!existingRule) {
    return c.json({ error: "Sender rule not found" }, 404);
  }

  await updateSenderRule(
    c.env.DB,
    household.id,
    ruleId,
    payload.providerId,
    payload.matchType,
    matchValue,
  );

  const rule = await getSenderRuleById(c.env.DB, household.id, ruleId);

  await audit(c, "sender_rule.updated", "sender_rule", ruleId, {
    providerId: payload.providerId,
    matchType: payload.matchType,
  });
  return c.json({ rule });
});

providersRoutes.delete("/:slug/provider-rules/:ruleId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const ruleId = c.req.param("ruleId");
  const rule = await getSenderRuleById(c.env.DB, household.id, ruleId);

  if (!rule) {
    return c.json({ error: "Sender rule not found" }, 404);
  }

  await deleteSenderRule(c.env.DB, household.id, ruleId);
  await audit(c, "sender_rule.deleted", "sender_rule", ruleId);

  return c.json({ ok: true });
});
