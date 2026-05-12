import { Hono } from "hono";

import { authForEnv } from "../auth/auth";
import { type AppVariables, requireOwner } from "../auth/middleware";
import {
  grantProviderAccess,
  listMemberProviderAccess,
  listMembers,
  listProviders,
  revokeProviderAccess,
} from "../db/repositories/member-access";
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
} from "../db/repositories/provider-rules";

type AccessPayload = {
  providerKey?: string;
};

type CreateMemberPayload = {
  email?: string;
  name?: string;
  password?: string;
  role?: string;
};

type ProviderPayload = {
  providerKey?: string;
  displayName?: string;
};

type SenderRulePayload = {
  providerId?: string;
  matchType?: string;
  matchValue?: string;
};

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function mapStoredRoleToAppRole(role: string | null | undefined) {
  return role === "admin" ? "admin" : "member";
}

function normalizeProviderKey(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeDisplayName(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizeMatchValue(matchType: string, value: string | undefined) {
  const trimmed = value?.trim().toLowerCase() ?? "";

  if (matchType === "domain") {
    return trimmed.replace(/^@+/, "");
  }

  return trimmed;
}

function isValidMatchType(value: string | undefined): value is "exact" | "domain" {
  return value === "exact" || value === "domain";
}

adminRoutes.use("*", requireOwner);

adminRoutes.get("/providers", async (c) => {
  const [providers, rules] = await Promise.all([
    listProviderConfigurations(c.env.DB),
    listSenderRules(c.env.DB),
  ]);

  return c.json({
    providers,
    rules,
  });
});

adminRoutes.post("/providers", async (c) => {
  let payload: ProviderPayload;

  try {
    payload = await c.req.json<ProviderPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const providerKey = normalizeProviderKey(payload.providerKey);
  const displayName = normalizeDisplayName(payload.displayName);

  if (!providerKey || !displayName) {
    return c.json({ error: "providerKey and displayName are required" }, 400);
  }

  const existing = await getProviderByKey(c.env.DB, providerKey);

  if (existing) {
    return c.json({ error: "Provider key already exists" }, 409);
  }

  const provider = await createProvider(c.env.DB, providerKey, displayName);

  return c.json({ provider }, 201);
});

adminRoutes.patch("/providers/:providerId", async (c) => {
  let payload: ProviderPayload;

  try {
    payload = await c.req.json<ProviderPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const providerId = c.req.param("providerId");
  const providerKey = normalizeProviderKey(payload.providerKey);
  const displayName = normalizeDisplayName(payload.displayName);

  if (!providerKey || !displayName) {
    return c.json({ error: "providerKey and displayName are required" }, 400);
  }

  const existing = await getProviderById(c.env.DB, providerId);

  if (!existing) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const conflict = await getProviderByKey(c.env.DB, providerKey);

  if (conflict && conflict.id !== providerId) {
    return c.json({ error: "Provider key already exists" }, 409);
  }

  await updateProvider(c.env.DB, providerId, providerKey, displayName);

  const provider = await getProviderById(c.env.DB, providerId);

  return c.json({ provider });
});

adminRoutes.delete("/providers/:providerId", async (c) => {
  const providerId = c.req.param("providerId");
  const provider = await getProviderById(c.env.DB, providerId);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  await deleteProvider(c.env.DB, providerId);

  return c.json({ ok: true });
});

adminRoutes.post("/provider-rules", async (c) => {
  let payload: SenderRulePayload;

  try {
    payload = await c.req.json<SenderRulePayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.providerId || !isValidMatchType(payload.matchType)) {
    return c.json({ error: "providerId and a valid matchType are required" }, 400);
  }

  const matchValue = normalizeMatchValue(payload.matchType, payload.matchValue);

  if (!matchValue) {
    return c.json({ error: "matchValue is required" }, 400);
  }

  const provider = await getProviderById(c.env.DB, payload.providerId);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const rule = await createSenderRule(
    c.env.DB,
    payload.providerId,
    payload.matchType,
    matchValue,
  );

  return c.json({ rule }, 201);
});

adminRoutes.patch("/provider-rules/:ruleId", async (c) => {
  let payload: SenderRulePayload;

  try {
    payload = await c.req.json<SenderRulePayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const ruleId = c.req.param("ruleId");

  if (!payload.providerId || !isValidMatchType(payload.matchType)) {
    return c.json({ error: "providerId and a valid matchType are required" }, 400);
  }

  const matchValue = normalizeMatchValue(payload.matchType, payload.matchValue);

  if (!matchValue) {
    return c.json({ error: "matchValue is required" }, 400);
  }

  const [provider, existingRule] = await Promise.all([
    getProviderById(c.env.DB, payload.providerId),
    getSenderRuleById(c.env.DB, ruleId),
  ]);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  if (!existingRule) {
    return c.json({ error: "Sender rule not found" }, 404);
  }

  await updateSenderRule(
    c.env.DB,
    ruleId,
    payload.providerId,
    payload.matchType,
    matchValue,
  );

  const rule = await getSenderRuleById(c.env.DB, ruleId);

  return c.json({ rule });
});

adminRoutes.delete("/provider-rules/:ruleId", async (c) => {
  const ruleId = c.req.param("ruleId");
  const rule = await getSenderRuleById(c.env.DB, ruleId);

  if (!rule) {
    return c.json({ error: "Sender rule not found" }, 404);
  }

  await deleteSenderRule(c.env.DB, ruleId);

  return c.json({ ok: true });
});

adminRoutes.get("/members", async (c) => {
  const [members, accessRows, providers] = await Promise.all([
    listMembers(c.env.DB),
    listMemberProviderAccess(c.env.DB),
    listProviders(c.env.DB),
  ]);

  const accessByUserId = new Map<
    string,
    Array<{ providerKey: string; displayName: string }>
  >();

  for (const row of accessRows) {
    if (!row.provider_key || !row.provider_display_name) {
      continue;
    }

    const current = accessByUserId.get(row.id) ?? [];
    current.push({
      providerKey: row.provider_key,
      displayName: row.provider_display_name,
    });
    accessByUserId.set(row.id, current);
  }

  return c.json({
    members: members.map((member) => ({
      ...member,
      role: mapStoredRoleToAppRole(member.role),
      providerAccess: accessByUserId.get(member.id) ?? [],
    })),
    providers,
  });
});

adminRoutes.post("/members", async (c) => {
  let payload: CreateMemberPayload;

  try {
    payload = await c.req.json<CreateMemberPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.email || !payload.name || !payload.password) {
    return c.json({ error: "email, name, and password are required" }, 400);
  }

  const role = payload.role === "admin" ? "admin" : "user";
  const headers = new Headers(c.req.raw.headers);

  const created = await authForEnv(c.env).api.createUser({
    body: {
      email: payload.email,
      name: payload.name,
      password: payload.password,
      role,
    },
    headers,
  });

  return c.json(
    {
      member: {
        ...created.user,
        role: mapStoredRoleToAppRole(created.user.role),
      },
    },
    201,
  );
});

adminRoutes.patch("/members/:userId/role", async (c) => {
  const userId = c.req.param("userId");
  const currentUser = c.get("user");

  if (currentUser && currentUser.id === userId) {
    return c.json(
      { error: "Cannot change your own role. Ask another admin." },
      403,
    );
  }

  let payload: { role?: string };

  try {
    payload = await c.req.json<{ role?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (payload.role !== "admin" && payload.role !== "member") {
    return c.json({ error: "role must be admin or member" }, 400);
  }

  await authForEnv(c.env).api.setRole({
    body: {
      userId,
      role: payload.role === "admin" ? "admin" : "user",
    },
    headers: new Headers(c.req.raw.headers),
  });

  return c.json({ ok: true });
});

adminRoutes.patch("/members/:userId/password", async (c) => {
  const userId = c.req.param("userId");
  let payload: { password?: string };

  try {
    payload = await c.req.json<{ password?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.password) {
    return c.json({ error: "password is required" }, 400);
  }

  await authForEnv(c.env).api.setUserPassword({
    body: {
      userId,
      newPassword: payload.password,
    },
    headers: new Headers(c.req.raw.headers),
  });

  return c.json({ ok: true });
});

adminRoutes.post("/members/:userId/provider-access", async (c) => {
  const userId = c.req.param("userId");
  let payload: AccessPayload;

  try {
    payload = await c.req.json<AccessPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.providerKey) {
    return c.json({ error: "providerKey is required" }, 400);
  }

  const provider = await getProviderByKey(c.env.DB, payload.providerKey);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  await grantProviderAccess(c.env.DB, userId, provider.id);
  return c.json({ ok: true });
});

adminRoutes.delete("/members/:userId/provider-access", async (c) => {
  const userId = c.req.param("userId");
  let payload: AccessPayload;

  try {
    payload = await c.req.json<AccessPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.providerKey) {
    return c.json({ error: "providerKey is required" }, 400);
  }

  const provider = await getProviderByKey(c.env.DB, payload.providerKey);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  await revokeProviderAccess(c.env.DB, userId, provider.id);
  return c.json({ ok: true });
});
