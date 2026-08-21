import {
  cancelInvitation,
  createHouseholdInvitation,
  getInvitationById,
  type InvitationRole,
} from "../db/repositories/invitations";
import { sendHouseholdInvitationEmail } from "../email/sender";
import { logEvent } from "../runtime/log";
import { createInvitationToken } from "../security/tokens";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Inviter = { id: string; name: string; email: string };

export type InviteInput = {
  email: string;
  name: string;
  role: InvitationRole;
  providerIds: string[];
};

export type InvitationDelivery = {
  emailSent: boolean;
  emailError?: string;
};

export type InviteResult = {
  invitation: NonNullable<Awaited<ReturnType<typeof getInvitationById>>>;
  inviteUrl: string;
} & InvitationDelivery;

export function buildInviteUrl(env: Pick<Env, "APP_URL">, token: string) {
  return `${env.APP_URL.replace(/\/$/, "")}/invite/${token}`;
}

/**
 * Sends the invitation email and reports whether it was handed to the email
 * binding. Failures are logged and surfaced instead of swallowed, so the
 * owner can fall back to sharing the link manually.
 */
async function deliverInvitationEmail(
  env: Env,
  input: {
    invitationId: string;
    to: string;
    inviteeName: string;
    inviter: Inviter;
    inviteUrl: string;
    expiresAt: string;
    role: InvitationRole;
  },
): Promise<InvitationDelivery> {
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

/**
 * Creates a pending invitation (token, 7-day expiry, optional provider
 * scope), emails it, and returns the record plus delivery outcome. Used by
 * "invite", "create member" and "resend".
 */
export async function inviteMember(
  db: D1Database,
  env: Env,
  householdId: string,
  inviter: Inviter,
  input: InviteInput,
): Promise<InviteResult | null> {
  const { token, tokenHash } = await createInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();

  const invitationId = await createHouseholdInvitation(db, {
    householdId,
    email: input.email,
    name: input.name,
    role: input.role,
    tokenHash,
    invitedByUserId: inviter.id,
    expiresAt,
    providerIds: input.providerIds,
  });

  const invitation = await getInvitationById(db, householdId, invitationId);
  if (!invitation) {
    return null;
  }

  const inviteUrl = buildInviteUrl(env, token);
  const delivery = await deliverInvitationEmail(env, {
    invitationId,
    to: invitation.email,
    inviteeName: invitation.name,
    inviter,
    inviteUrl,
    expiresAt,
    role: invitation.role,
  });

  return { invitation, inviteUrl, ...delivery };
}

/**
 * Cancels a pending invitation and issues a fresh one with the same
 * recipient, role and provider scope (new token, new expiry).
 */
export async function resendInvitation(
  db: D1Database,
  env: Env,
  householdId: string,
  inviter: Inviter,
  invitationId: string,
): Promise<InviteResult | null> {
  const existing = await getInvitationById(db, householdId, invitationId);
  if (existing?.status !== "pending") {
    return null;
  }

  await cancelInvitation(db, invitationId);

  return inviteMember(db, env, householdId, inviter, {
    email: existing.email,
    name: existing.name,
    role: existing.role,
    providerIds: existing.providers.map((provider) => provider.id),
  });
}
