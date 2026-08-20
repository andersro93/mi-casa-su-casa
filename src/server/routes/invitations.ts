import { isAPIError } from "better-auth/api";
import { Hono } from "hono";

import { provisioningAuthForEnv } from "../auth/auth";
import { loadAuthSession, requireAuthenticatedUser } from "../auth/middleware";
import { getHouseholdById } from "../db/repositories/households";
import {
  acceptInvitation,
  getInvitationByTokenHash,
  refreshExpiredInvitations,
} from "../db/repositories/invitations";
import { deleteUserById, findUserByEmail } from "../db/repositories/users";
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

invitationRoutes.get("/:token", async (c) => {
  await refreshExpiredInvitations(c.env.DB);
  const tokenHash = await hashInvitationToken(c.req.param("token"));
  const invitation = await getInvitationByTokenHash(c.env.DB, tokenHash);

  if (!invitation || invitation.status !== "pending") {
    return c.json({ error: "Invitation not found or no longer valid" }, 404);
  }

  return c.json({ invitation: withoutToken(invitation) });
});

invitationRoutes.post("/:token/accept", async (c) => {
  await refreshExpiredInvitations(c.env.DB);

  let payload: AcceptInvitationPayload;

  try {
    payload = await c.req.json<AcceptInvitationPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.name || !payload.password || payload.password.length < 12) {
    return c.json(
      {
        error: "name and a password with at least 12 characters are required",
      },
      400,
    );
  }

  const tokenHash = await hashInvitationToken(c.req.param("token"));
  const invitation = await getInvitationByTokenHash(c.env.DB, tokenHash);

  if (!invitation || invitation.status !== "pending") {
    return c.json({ error: "Invitation not found or no longer valid" }, 404);
  }

  const auth = provisioningAuthForEnv(c.env);
  const currentUser = c.get("user");

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
          name: payload.name.trim(),
          role: invitation.role,
        },
        household,
      },
      200,
    );
  }

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
        name: payload.name.trim(),
        password: payload.password,
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
    console.error(
      JSON.stringify({
        event: "invitation_accept_failed",
        invitationId: invitation.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

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
