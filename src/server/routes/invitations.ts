import { isAPIError } from "better-auth/api";
import { Hono } from "hono";

import { authForEnv } from "../auth/auth";
import { loadAuthSession, requireAuthenticatedUser } from "../auth/middleware";
import {
  acceptInvitation,
  getInvitationByTokenHash,
  refreshExpiredInvitations,
} from "../db/repositories/invitations";
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

export const invitationRoutes = new Hono<{ Bindings: Env }>();

invitationRoutes.use("*", loadAuthSession);

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

  const auth = authForEnv(c.env);

  try {
    const created = await auth.api.createUser({
      body: {
        email: invitation.email,
        name: payload.name.trim(),
        password: payload.password,
        role: invitation.role === "admin" ? "admin" : "user",
      },
    });

    await acceptInvitation(c.env.DB, {
      invitationId: invitation.id,
      acceptedByUserId: created.user.id,
      providerIds: invitation.providers.map((provider) => provider.id),
    });

    const signInResult = await auth.api.signInEmail({
      body: {
        email: invitation.email,
        password: payload.password,
      },
      headers: new Headers(c.req.raw.headers),
      returnHeaders: true,
    });

    const response = c.json(
      {
        member: {
          id: created.user.id,
          email: created.user.email,
          name: created.user.name,
          role: invitation.role,
        },
        session: signInResult.response,
      },
      201,
    );

    for (const cookie of signInResult.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }

    return response;
  } catch (error) {
    if (isAPIError(error)) {
      c.status(typeof error.status === "number" ? 400 : 400);
      return c.json({ error: error.message });
    }

    return c.json({ error: "Unable to accept invitation" }, 500);
  }
});

export const authenticatedInvitationRoutes = new Hono<{ Bindings: Env }>();

authenticatedInvitationRoutes.use("*", requireAuthenticatedUser);
