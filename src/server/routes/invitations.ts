import { isAPIError } from "better-auth/api";
import { Hono } from "hono";

import { provisioningAuthForEnv } from "../auth/auth";
import { loadAuthSession, requireAuthenticatedUser } from "../auth/middleware";
import { getHouseholdById } from "../db/repositories/households";
import {
  acceptInvitation,
  getInvitationByTokenHash,
  isInvitationExpired,
  refreshExpiredInvitations,
} from "../db/repositories/invitations";
import { deleteUserById, findUserByEmail } from "../db/repositories/users";
import { logEvent } from "../runtime/log";
import { RATE_LIMITS, rateLimit } from "../security/rate-limit";
import { hashInvitationToken } from "../security/tokens";

type AcceptInvitationPayload = {
  name?: string;
  password?: string;
};

function withoutToken(
  invitation: Awaited<ReturnType<typeof getInvitationByTokenHash>>,
) {
  if (!invitation) {
    return null;
  }

  return invitation;
}

export const invitationRoutes = new Hono<{
  Bindings: Env;
  Variables: import("../auth/middleware").AppVariables;
}>();

invitationRoutes.use("*", loadAuthSession);
invitationRoutes.use("*", rateLimit(RATE_LIMITS.invitations));

export const INVITATION_TOKEN_HEADER = "x-invitation-token";

/**
 * The invitation token is a secret; it travels in a header instead of the
 * URL so it never lands in request/URL logs or referrers.
 */
function invitationTokenFrom(headers: Headers): string | null {
  const value = headers.get(INVITATION_TOKEN_HEADER)?.trim();
  return value ? value : null;
}

invitationRoutes.get("/lookup", async (c) => {
  const token = invitationTokenFrom(c.req.raw.headers);
  if (!token) {
    return c.json({ error: "Invitation token header is required" }, 400);
  }
  await refreshExpiredInvitations(c.env.DB);
  const tokenHash = await hashInvitationToken(token);
  const invitation = await getInvitationByTokenHash(c.env.DB, tokenHash);

  if (!invitation || invitation.status !== "pending") {
    return c.json({ error: "Invitation not found or no longer valid" }, 404);
  }

  if (isInvitationExpired(invitation)) {
    return c.json({ error: "This invitation has expired" }, 410);
  }

  const currentUser = c.get("user");
  const accountExists = Boolean(
    await findUserByEmail(c.env.DB, invitation.email),
  );

  return c.json({
    invitation: withoutToken(invitation),
    // Lets the invite page pick the right flow: create an account, sign in
    // first, or accept as the signed-in user.
    accountExists,
    viewer: currentUser
      ? {
          email: currentUser.email,
          emailMatches:
            currentUser.email.toLowerCase() === invitation.email.toLowerCase(),
        }
      : null,
  });
});

invitationRoutes.post("/accept", async (c) => {
  const token = invitationTokenFrom(c.req.raw.headers);
  if (!token) {
    return c.json({ error: "Invitation token header is required" }, 400);
  }
  await refreshExpiredInvitations(c.env.DB);

  let payload: AcceptInvitationPayload = {};

  try {
    const raw = await c.req.text();
    payload = raw.trim() ? (JSON.parse(raw) as AcceptInvitationPayload) : {};
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const tokenHash = await hashInvitationToken(token);
  const invitation = await getInvitationByTokenHash(c.env.DB, tokenHash);

  if (!invitation || invitation.status !== "pending") {
    return c.json({ error: "Invitation not found or no longer valid" }, 404);
  }

  if (isInvitationExpired(invitation)) {
    return c.json({ error: "This invitation has expired" }, 410);
  }

  const auth = provisioningAuthForEnv(c.env);
  const currentUser = c.get("user");

  // A signed-in user accepts with their existing account: no password, no
  // name required.
  if (!currentUser) {
    if (!payload.name || !payload.password || payload.password.length < 12) {
      return c.json(
        {
          error: "name and a password with at least 12 characters are required",
        },
        400,
      );
    }
  }

  if (currentUser) {
    if (currentUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return c.json(
        {
          error:
            "You are signed in as a different account. Sign out and accept the invitation with the invited email address.",
        },
        403,
      );
    }

    await acceptInvitation(c.env.DB, {
      invitationId: invitation.id,
      householdId: invitation.householdId,
      acceptedByUserId: currentUser.id,
      role: invitation.role,
    });

    const household = await getHouseholdById(c.env.DB, invitation.householdId);

    return c.json(
      {
        member: {
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name,
          role: invitation.role,
        },
        household,
      },
      200,
    );
  }

  const name = payload.name?.trim() ?? "";
  const password = payload.password ?? "";

  // An account for the invited address already exists (e.g. an earlier
  // attempt was interrupted after sign-up, or the person already has an
  // account): they must sign in and accept, instead of a confusing
  // USER_ALREADY_EXISTS from sign-up.
  if (await findUserByEmail(c.env.DB, invitation.email)) {
    return c.json(
      {
        error:
          "An account with the invited email already exists. Sign in with it, then open the invitation link again.",
        code: "ACCOUNT_EXISTS",
      },
      409,
    );
  }

  let createdUserId: string | null = null;

  try {
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: invitation.email,
        name,
        password,
      },
      headers: new Headers(c.req.raw.headers),
      returnHeaders: true,
    });

    const createdUser = signUpResult.response.user;
    createdUserId = createdUser.id;

    await acceptInvitation(c.env.DB, {
      invitationId: invitation.id,
      householdId: invitation.householdId,
      acceptedByUserId: createdUser.id,
      role: invitation.role,
    });

    const household = await getHouseholdById(c.env.DB, invitation.householdId);

    const response = c.json(
      {
        member: {
          id: createdUser.id,
          email: createdUser.email,
          name: createdUser.name,
          role: invitation.role,
        },
        household,
      },
      201,
    );

    for (const cookie of signUpResult.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }

    return response;
  } catch (error) {
    logEvent("error", "invitation_accept_failed", {
      invitationId: invitation.id,
      error: error instanceof Error ? error.message : String(error),
    });

    // Compensate: the sign-up succeeded but the membership did not; remove the
    // half-created account so the invitee can simply retry the link.
    if (createdUserId) {
      await deleteUserById(c.env.DB, createdUserId).catch(() => undefined);
    }

    if (isAPIError(error)) {
      const status = typeof error.status === "number" ? error.status : 400;
      return c.json({ error: error.message }, status as 400);
    }

    return c.json({ error: "Unable to accept invitation" }, 500);
  }
});

export const authenticatedInvitationRoutes = new Hono<{ Bindings: Env }>();

authenticatedInvitationRoutes.use("*", requireAuthenticatedUser);
