import { Hono } from "hono";

import {
  type AppVariables,
  requireHouseholdContext,
  requireOwner,
} from "../auth/middleware";
import {
  assertProvidersBelongToHousehold,
  getHouseholdMembership,
  updateHouseholdMembershipRole,
} from "../db/repositories/households";
import {
  cancelInvitation,
  createHouseholdInvitation,
  getInvitationById,
  type InvitationRole,
  listHouseholdInvitations,
  refreshExpiredInvitations,
} from "../db/repositories/invitations";
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
import { sendHouseholdInvitationEmail } from "../email/sender";
import { createInvitationToken } from "../security/tokens";

type AccessPayload = {
  providerKey?: string;
};

type CreateMemberPayload = {
  email?: string;
  name?: string;
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

type InvitationPayload = {
  email?: string;
  name?: string;
  role?: InvitationRole | "admin";
  providerIds?: string[];
};

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function normalizeProviderKey(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeDisplayName(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizeEmail(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeMatchValue(matchType: string, value: string | undefined) {
  const trimmed = value?.trim().toLowerCase() ?? "";

  if (matchType === "domain") {
    return trimmed.replace(/^@+/, "");
  }

  return trimmed;
}

function isValidMatchType(
  value: string | undefined,
): value is "exact" | "domain" {
  return value === "exact" || value === "domain";
}

adminRoutes.use("/:slug/*", requireHouseholdContext);
adminRoutes.use("/:slug/*", requireOwner);

adminRoutes.get("/:slug/providers", async (c) => {
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

adminRoutes.post("/:slug/providers", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
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

  return c.json({ provider }, 201);
});

adminRoutes.patch("/:slug/providers/:providerId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
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

  return c.json({ provider });
});

adminRoutes.delete("/:slug/providers/:providerId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const providerId = c.req.param("providerId");
  const provider = await getProviderById(c.env.DB, household.id, providerId);

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  await deleteProvider(c.env.DB, household.id, providerId);

  return c.json({ ok: true });
});

adminRoutes.post("/:slug/provider-rules", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  let payload: SenderRulePayload;

  try {
    payload = await c.req.json<SenderRulePayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.providerId || !isValidMatchType(payload.matchType)) {
    return c.json(
      { error: "providerId and a valid matchType are required" },
      400,
    );
  }

  const matchValue = normalizeMatchValue(payload.matchType, payload.matchValue);

  if (!matchValue) {
    return c.json({ error: "matchValue is required" }, 400);
  }

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

  return c.json({ rule }, 201);
});

adminRoutes.patch("/:slug/provider-rules/:ruleId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  let payload: SenderRulePayload;

  try {
    payload = await c.req.json<SenderRulePayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const ruleId = c.req.param("ruleId");

  if (!payload.providerId || !isValidMatchType(payload.matchType)) {
    return c.json(
      { error: "providerId and a valid matchType are required" },
      400,
    );
  }

  const matchValue = normalizeMatchValue(payload.matchType, payload.matchValue);

  if (!matchValue) {
    return c.json({ error: "matchValue is required" }, 400);
  }

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

  return c.json({ rule });
});

adminRoutes.delete("/:slug/provider-rules/:ruleId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const ruleId = c.req.param("ruleId");
  const rule = await getSenderRuleById(c.env.DB, household.id, ruleId);

  if (!rule) {
    return c.json({ error: "Sender rule not found" }, 404);
  }

  await deleteSenderRule(c.env.DB, household.id, ruleId);

  return c.json({ ok: true });
});

adminRoutes.get("/:slug/members", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const [members, accessRows, providers] = await Promise.all([
    listMembers(c.env.DB, household.id),
    listMemberProviderAccess(c.env.DB, household.id),
    listProviders(c.env.DB, household.id),
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
      role: member.householdRole === "owner" ? "admin" : "member",
      providerAccess: accessByUserId.get(member.id) ?? [],
    })),
    providers,
  });
});

adminRoutes.get("/:slug/invitations", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  await refreshExpiredInvitations(c.env.DB);
  const invitations = await listHouseholdInvitations(c.env.DB, household.id);
  return c.json({ invitations });
});

adminRoutes.post("/:slug/invitations", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  let payload: InvitationPayload;

  try {
    payload = await c.req.json<InvitationPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email = normalizeEmail(payload.email);
  const name = normalizeDisplayName(payload.name);
  const role: InvitationRole =
    payload.role === "owner" || payload.role === "admin" ? "owner" : "member";
  const providerIds = Array.isArray(payload.providerIds)
    ? payload.providerIds.filter((providerId) => Boolean(providerId))
    : [];

  if (!email || !name) {
    return c.json({ error: "email and name are required" }, 400);
  }

  const providersBelong = await assertProvidersBelongToHousehold(
    c.env.DB,
    household.id,
    providerIds,
  );

  if (!providersBelong) {
    return c.json(
      {
        error: "One or more selected providers do not belong to this household",
      },
      400,
    );
  }

  const inviter = c.get("user");

  if (!inviter) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { token, tokenHash } = await createInvitationToken();
  const expiresAt = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * 7,
  ).toISOString();
  const invitationId = await createHouseholdInvitation(c.env.DB, {
    householdId: household.id,
    email,
    name,
    role,
    tokenHash,
    invitedByUserId: inviter.id,
    expiresAt,
    providerIds,
  });

  const invitation = await getInvitationById(c.env.DB, invitationId);

  if (!invitation) {
    return c.json({ error: "Unable to create invitation" }, 500);
  }

  void sendHouseholdInvitationEmail(c.env, {
    to: email,
    inviteeName: name,
    inviterName: inviter.email,
    inviterEmail: inviter.email,
    inviteUrl: `${c.env.APP_URL.replace(/\/$/, "")}/invite/${token}`,
    expiresAt,
    role,
  });

  return c.json({ invitation }, 201);
});

adminRoutes.post("/:slug/invitations/:invitationId/resend", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  await refreshExpiredInvitations(c.env.DB);

  const invitationId = c.req.param("invitationId");
  const invitation = await getInvitationById(c.env.DB, invitationId);

  if (
    !invitation ||
    invitation.householdId !== household.id ||
    invitation.status !== "pending"
  ) {
    return c.json({ error: "Invitation not found or not resendable" }, 404);
  }

  const inviter = c.get("user");

  if (!inviter) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { token, tokenHash } = await createInvitationToken();
  const expiresAt = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * 7,
  ).toISOString();

  await cancelInvitation(c.env.DB, invitationId);

  const replacementId = await createHouseholdInvitation(c.env.DB, {
    householdId: household.id,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    tokenHash,
    invitedByUserId: inviter.id,
    expiresAt,
    providerIds: invitation.providers.map((provider) => provider.id),
  });

  const replacement = await getInvitationById(c.env.DB, replacementId);

  if (!replacement) {
    return c.json({ error: "Unable to resend invitation" }, 500);
  }

  void sendHouseholdInvitationEmail(c.env, {
    to: replacement.email,
    inviteeName: replacement.name,
    inviterName: inviter.email,
    inviterEmail: inviter.email,
    inviteUrl: `${c.env.APP_URL.replace(/\/$/, "")}/invite/${token}`,
    expiresAt,
    role: replacement.role,
  });

  return c.json({ invitation: replacement });
});

adminRoutes.delete("/:slug/invitations/:invitationId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const invitationId = c.req.param("invitationId");
  const invitation = await getInvitationById(c.env.DB, invitationId);

  if (!invitation || invitation.householdId !== household.id) {
    return c.json({ error: "Invitation not found" }, 404);
  }

  await cancelInvitation(c.env.DB, invitationId);
  return c.json({ ok: true });
});

adminRoutes.post("/:slug/members", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  let payload: CreateMemberPayload;

  try {
    payload = await c.req.json<CreateMemberPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.email || !payload.name) {
    return c.json({ error: "email and name are required" }, 400);
  }

  const inviter = c.get("user");

  if (!inviter) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { token, tokenHash } = await createInvitationToken();
  const expiresAt = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * 7,
  ).toISOString();
  const invitationRole: InvitationRole =
    payload.role === "admin" ? "owner" : "member";

  const invitationId = await createHouseholdInvitation(c.env.DB, {
    householdId: household.id,
    email: normalizeEmail(payload.email),
    name: payload.name.trim(),
    role: invitationRole,
    tokenHash,
    invitedByUserId: inviter.id,
    expiresAt,
    providerIds: [],
  });

  const invitation = await getInvitationById(c.env.DB, invitationId);

  if (!invitation) {
    return c.json({ error: "Unable to create invitation" }, 500);
  }

  void sendHouseholdInvitationEmail(c.env, {
    to: invitation.email,
    inviteeName: invitation.name,
    inviterName: inviter.email,
    inviterEmail: inviter.email,
    inviteUrl: `${c.env.APP_URL.replace(/\/$/, "")}/invite/${token}`,
    expiresAt,
    role: invitation.role,
  });

  return c.json({ invitation }, 201);
});

adminRoutes.patch("/:slug/members/:userId/role", async (c) => {
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

  const household = c.get("household");

  if (!household) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const membership = await getHouseholdMembership(
    c.env.DB,
    userId,
    household.id,
  );

  if (!membership) {
    return c.json({ error: "Member not found" }, 404);
  }

  await updateHouseholdMembershipRole(c.env.DB, {
    householdId: household.id,
    userId,
    role: payload.role === "admin" ? "owner" : "member",
  });

  return c.json({ ok: true });
});

adminRoutes.post("/:slug/members/:userId/provider-access", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
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

  const provider = await getProviderByKey(
    c.env.DB,
    household.id,
    payload.providerKey,
  );

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const membership = await getHouseholdMembership(
    c.env.DB,
    userId,
    household.id,
  );

  if (!membership) {
    return c.json({ error: "Member not found" }, 404);
  }

  await grantProviderAccess(c.env.DB, household.id, userId, provider.id);
  return c.json({ ok: true });
});

adminRoutes.delete("/:slug/members/:userId/provider-access", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
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

  const provider = await getProviderByKey(
    c.env.DB,
    household.id,
    payload.providerKey,
  );

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const membership = await getHouseholdMembership(
    c.env.DB,
    userId,
    household.id,
  );

  if (!membership) {
    return c.json({ error: "Member not found" }, 404);
  }

  await revokeProviderAccess(c.env.DB, household.id, userId, provider.id);
  return c.json({ ok: true });
});
