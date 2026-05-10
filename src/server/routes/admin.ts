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
import { getProviderByKey } from "../db/repositories/provider-rules";

type AccessPayload = {
  providerKey?: string;
};

type CreateMemberPayload = {
  email?: string;
  name?: string;
  password?: string;
  role?: string;
};

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function mapStoredRoleToAppRole(role: string | null | undefined) {
  return role === "admin" ? "admin" : "member";
}

adminRoutes.use("*", requireOwner);

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
