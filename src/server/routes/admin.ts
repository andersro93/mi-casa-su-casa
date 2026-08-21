import { Hono } from "hono";

import {
  type AppVariables,
  requireHouseholdContext,
  requireOwner,
} from "../auth/middleware";
import { listAuditEvents, recordAuditEvent } from "../db/repositories/audit";
import {
  assertProvidersBelongToHousehold,
  countHouseholdOwners,
  getHouseholdMembership,
  getHouseholdSettings,
  removeUserFromHousehold,
  updateHouseholdDisplayName,
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
import {
  createMemberSchema,
  householdSettingsSchema,
  invitationSchema,
  providerAccessSchema,
  providerSchema,
  roleChangeSchema,
  senderRuleSchema,
} from "../http/schemas";
import { parseJsonBody } from "../http/validation";
import { logEvent } from "../runtime/log";
import { createInvitationToken } from "../security/tokens";

type AuditContext = {
  env: Env;
  get: (key: "user") => { id: string } | null;
};

function audit(
  c: AuditContext & { get: (key: "household") => { id: string } | null },
  action: string,
  targetType: string,
  targetId: string | null,
  details?: Record<string, unknown>,
) {
  return recordAuditEvent(c.env.DB, {
    actorUserId: c.get("user")?.id ?? null,
    householdId: c.get("household")?.id ?? null,
    action,
    targetType,
    targetId,
    details,
  });
}

function buildInviteUrl(env: Env, token: string) {
  return `${env.APP_URL.replace(/\/$/, "")}/invite/${token}`;
}

/**
 * Sends the invitation email and reports whether it was delivered to the
 * email binding. Failures are logged and surfaced to the caller instead of
 * being swallowed, so the owner can fall back to sharing the link manually.
 */
async function deliverInvitationEmail(
  env: Env,
  input: {
    invitationId: string;
    to: string;
    inviteeName: string;
    inviter: { name: string; email: string };
    inviteUrl: string;
    expiresAt: string;
    role: InvitationRole;
  },
): Promise<{ emailSent: boolean; emailError?: string }> {
  try {
    await sendHouseholdInvitationEmail(env, {
      to: input.to,
      inviteeName: input.inviteeName,
      inviterName: input.inviter.name,
      inviterEmail: input.inviter.email,
      inviteUrl: input.inviteUrl,
      expiresAt: input.expiresAt,
      role: input.role,
    });
    return { emailSent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("error", "invitation_email_failed", {
      invitationId: input.invitationId,
      to: input.to,
      error: message,
    });
    return { emailSent: false, emailError: message };
  }
}

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

function householdSettingsPayload(
  env: Env,
  settings: { slug: string; displayName: string },
) {
  const domain = env.EMAIL_DOMAIN?.trim();
  return {
    slug: settings.slug,
    displayName: settings.displayName,
    // The address providers must send codes to; null until EMAIL_DOMAIN is set.
    emailAddress: domain ? `${settings.slug}@${domain}` : null,
  };
}

adminRoutes.use("/:slug/*", requireHouseholdContext);
adminRoutes.use("/:slug/*", requireOwner);

adminRoutes.get("/:slug/audit", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const events = await listAuditEvents(c.env.DB, household.id);
  return c.json({ events });
});

adminRoutes.get("/:slug/settings", async (c) => {
  const household = c.get("household");

  if (!household) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const settings = await getHouseholdSettings(c.env.DB, household.id);

  if (!settings) {
    return c.json({ error: "Household not found" }, 404);
  }

  return c.json({ household: householdSettingsPayload(c.env, settings) });
});

adminRoutes.patch("/:slug/settings", async (c) => {
  const household = c.get("household");

  if (!household) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await parseJsonBody(c, householdSettingsSchema);
  if (!body.ok) return body.response;
  const { displayName } = body.data;

  const settings = await updateHouseholdDisplayName(
    c.env.DB,
    household.id,
    displayName,
  );

  if (!settings) {
    return c.json({ error: "Household not found" }, 404);
  }

  await audit(c, "household.settings_updated", "household", household.id, {
    displayName,
  });

  return c.json({ household: householdSettingsPayload(c.env, settings) });
});

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

adminRoutes.patch("/:slug/providers/:providerId", async (c) => {
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

adminRoutes.delete("/:slug/providers/:providerId", async (c) => {
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

adminRoutes.post("/:slug/provider-rules", async (c) => {
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

adminRoutes.patch("/:slug/provider-rules/:ruleId", async (c) => {
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

adminRoutes.delete("/:slug/provider-rules/:ruleId", async (c) => {
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
      role: member.householdRole,
      providerAccess: accessByUserId.get(member.id) ?? [],
    })),
    providers,
  });
});

adminRoutes.get("/:slug/invitations", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  await refreshExpiredInvitations(c.env.DB, new Date(), household.id);
  const invitations = await listHouseholdInvitations(c.env.DB, household.id);
  return c.json({ invitations });
});

adminRoutes.post("/:slug/invitations", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const body = await parseJsonBody(c, invitationSchema);
  if (!body.ok) return body.response;
  const { email, name, role, providerIds } = body.data;

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

  const invitation = await getInvitationById(
    c.env.DB,
    household.id,
    invitationId,
  );

  if (!invitation) {
    return c.json({ error: "Unable to create invitation" }, 500);
  }

  const inviteUrl = buildInviteUrl(c.env, token);
  const delivery = await deliverInvitationEmail(c.env, {
    invitationId,
    to: email,
    inviteeName: name,
    inviter,
    inviteUrl,
    expiresAt,
    role,
  });

  await audit(c, "invitation.created", "invitation", invitation.id, {
    email: invitation.email,
    role: invitation.role,
    emailSent: delivery.emailSent,
  });

  return c.json({ invitation, inviteUrl, ...delivery }, 201);
});

adminRoutes.post("/:slug/invitations/:invitationId/resend", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  await refreshExpiredInvitations(c.env.DB, new Date(), household.id);

  const invitationId = c.req.param("invitationId");
  const invitation = await getInvitationById(
    c.env.DB,
    household.id,
    invitationId,
  );

  if (!invitation || invitation.status !== "pending") {
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

  const replacement = await getInvitationById(
    c.env.DB,
    household.id,
    replacementId,
  );

  if (!replacement) {
    return c.json({ error: "Unable to resend invitation" }, 500);
  }

  const inviteUrl = buildInviteUrl(c.env, token);
  const delivery = await deliverInvitationEmail(c.env, {
    invitationId: replacementId,
    to: replacement.email,
    inviteeName: replacement.name,
    inviter,
    inviteUrl,
    expiresAt,
    role: replacement.role,
  });

  await audit(c, "invitation.resent", "invitation", replacement.id, {
    email: replacement.email,
    replaces: invitationId,
    emailSent: delivery.emailSent,
  });

  return c.json({ invitation: replacement, inviteUrl, ...delivery });
});

adminRoutes.delete("/:slug/invitations/:invitationId", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const invitationId = c.req.param("invitationId");
  const invitation = await getInvitationById(
    c.env.DB,
    household.id,
    invitationId,
  );

  if (!invitation) {
    return c.json({ error: "Invitation not found" }, 404);
  }

  await cancelInvitation(c.env.DB, invitationId);
  await audit(c, "invitation.cancelled", "invitation", invitationId);
  return c.json({ ok: true });
});

adminRoutes.post("/:slug/members", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const body = await parseJsonBody(c, createMemberSchema);
  if (!body.ok) return body.response;
  const payload = body.data;
  const memberEmail = payload.email;

  const inviter = c.get("user");

  if (!inviter) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { token, tokenHash } = await createInvitationToken();
  const expiresAt = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * 7,
  ).toISOString();
  const invitationRole: InvitationRole = payload.role;

  const invitationId = await createHouseholdInvitation(c.env.DB, {
    householdId: household.id,
    email: memberEmail,
    name: payload.name,
    role: invitationRole,
    tokenHash,
    invitedByUserId: inviter.id,
    expiresAt,
    providerIds: [],
  });

  const invitation = await getInvitationById(
    c.env.DB,
    household.id,
    invitationId,
  );

  if (!invitation) {
    return c.json({ error: "Unable to create invitation" }, 500);
  }

  const inviteUrl = buildInviteUrl(c.env, token);
  const delivery = await deliverInvitationEmail(c.env, {
    invitationId,
    to: invitation.email,
    inviteeName: invitation.name,
    inviter,
    inviteUrl,
    expiresAt,
    role: invitation.role,
  });

  await audit(c, "invitation.created", "invitation", invitation.id, {
    email: invitation.email,
    role: invitation.role,
    emailSent: delivery.emailSent,
  });

  return c.json({ invitation, inviteUrl, ...delivery }, 201);
});

adminRoutes.delete("/:slug/members/:userId", async (c) => {
  const household = c.get("household");
  const currentUser = c.get("user");
  const userId = c.req.param("userId");

  if (!household || !currentUser) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (currentUser.id === userId) {
    return c.json({ error: "Use 'Leave household' to remove yourself." }, 400);
  }

  const membership = await getHouseholdMembership(
    c.env.DB,
    userId,
    household.id,
  );

  if (!membership) {
    return c.json({ error: "Member not found" }, 404);
  }

  if (
    membership.role === "owner" &&
    (await countHouseholdOwners(c.env.DB, household.id)) <= 1
  ) {
    return c.json({ error: "A household must keep at least one owner." }, 409);
  }

  await removeUserFromHousehold(c.env.DB, {
    householdId: household.id,
    userId,
  });
  logEvent("info", "member_removed", {
    householdId: household.id,
    userId,
    byUserId: currentUser.id,
  });
  await audit(c, "member.removed", "user", userId);

  return c.json({ ok: true });
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

  const body = await parseJsonBody(c, roleChangeSchema);
  if (!body.ok) return body.response;
  const nextRole = body.data.role;

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
    role: nextRole,
  });
  await audit(c, "member.role_changed", "user", userId, { role: nextRole });

  return c.json({ ok: true });
});

adminRoutes.post("/:slug/members/:userId/provider-access", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const userId = c.req.param("userId");
  const body = await parseJsonBody(c, providerAccessSchema);
  if (!body.ok) return body.response;
  const payload = body.data;

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
  await audit(c, "member.provider_access_granted", "user", userId, {
    providerKey: payload.providerKey,
  });
  return c.json({ ok: true });
});

// Accepts the provider key in the URL (preferred) or, for older clients, in a
// JSON body on DELETE.
adminRoutes.delete(
  "/:slug/members/:userId/provider-access/:providerKey?",
  async (c) => {
    const household = c.get("household");
    if (!household) return c.json({ error: "Forbidden" }, 403);
    const userId = c.req.param("userId");
    let payload: { providerKey: string };
    const fromPath = c.req.param("providerKey");
    if (fromPath) {
      const parsed = providerAccessSchema.safeParse({ providerKey: fromPath });
      if (!parsed.success) {
        return c.json({ error: "providerKey is invalid" }, 400);
      }
      payload = parsed.data;
    } else {
      const body = await parseJsonBody(c, providerAccessSchema);
      if (!body.ok) return body.response;
      payload = body.data;
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
    await audit(c, "member.provider_access_revoked", "user", userId, {
      providerKey: payload.providerKey,
    });
    return c.json({ ok: true });
  },
);
