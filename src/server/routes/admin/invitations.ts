import { Hono } from "hono";

import type { AppVariables } from "../../auth/middleware";
import { assertProvidersBelongToHousehold } from "../../db/repositories/households";
import {
  cancelInvitation,
  getInvitationById,
  listHouseholdInvitations,
  refreshExpiredInvitations,
} from "../../db/repositories/invitations";
import {
  listMemberProviderAccess,
  listMembers,
  listProviders,
} from "../../db/repositories/member-access";
import { inviteMember, resendInvitation } from "../../domain/invitations";
import { createMemberSchema, invitationSchema } from "../../http/schemas";
import { parseJsonBody } from "../../http/validation";
import { audit } from "./audit";

export const invitationsRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

invitationsRoutes.get("/:slug/members", async (c) => {
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

invitationsRoutes.get("/:slug/invitations", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  await refreshExpiredInvitations(c.env.DB, new Date(), household.id);
  const invitations = await listHouseholdInvitations(c.env.DB, household.id);
  return c.json({ invitations });
});

invitationsRoutes.post("/:slug/invitations", async (c) => {
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

  const result = await inviteMember(c.env.DB, c.env, household.id, inviter, {
    email,
    name,
    role,
    providerIds,
  });

  if (!result) {
    return c.json({ error: "Unable to create invitation" }, 500);
  }

  await audit(c, "invitation.created", "invitation", result.invitation.id, {
    email: result.invitation.email,
    role: result.invitation.role,
    emailSent: result.emailSent,
  });

  return c.json(result, 201);
});

invitationsRoutes.post("/:slug/invitations/:invitationId/resend", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  await refreshExpiredInvitations(c.env.DB, new Date(), household.id);

  const invitationId = c.req.param("invitationId");
  const inviter = c.get("user");

  if (!inviter) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await resendInvitation(
    c.env.DB,
    c.env,
    household.id,
    inviter,
    invitationId,
  );

  if (!result) {
    return c.json({ error: "Invitation not found or not resendable" }, 404);
  }

  await audit(c, "invitation.resent", "invitation", result.invitation.id, {
    email: result.invitation.email,
    replaces: invitationId,
    emailSent: result.emailSent,
  });

  return c.json(result);
});

invitationsRoutes.delete("/:slug/invitations/:invitationId", async (c) => {
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

invitationsRoutes.post("/:slug/members", async (c) => {
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

  const result = await inviteMember(c.env.DB, c.env, household.id, inviter, {
    email: memberEmail,
    name: payload.name,
    role: payload.role,
    providerIds: [],
  });

  if (!result) {
    return c.json({ error: "Unable to create invitation" }, 500);
  }

  await audit(c, "invitation.created", "invitation", result.invitation.id, {
    email: result.invitation.email,
    role: result.invitation.role,
    emailSent: result.emailSent,
  });

  return c.json(result, 201);
});
