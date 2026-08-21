import { isAPIError } from "better-auth/api";
import { Hono } from "hono";

import { provisioningAuthForEnv } from "../auth/auth";
import { isUniqueViolation } from "../db/errors";
import { recordAuditEvent } from "../db/repositories/audit";
import {
  createHousehold,
  listHouseholdsForUser,
} from "../db/repositories/households";
import {
  beginInstallationSetup,
  completeInstallationSetup,
  getInstallationState,
  resetInstallationSetup,
} from "../db/repositories/installation-state";
import { deleteUserById, findUserByEmail } from "../db/repositories/users";
import { setupSchema } from "../http/schemas";
import { parseJsonBody } from "../http/validation";
import { logEvent } from "../runtime/log";
import { secretsEqual } from "../security/compare";
import { RATE_LIMITS, rateLimit } from "../security/rate-limit";

export const setupRoutes = new Hono<{ Bindings: Env }>();

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function mapInstallationStatus(
  row: Awaited<ReturnType<typeof getInstallationState>>,
  env: Env,
) {
  const isConfigured = Boolean(env.OWNER_EMAIL && env.SETUP_SECRET);
  const needsSetup = isConfigured && row.status !== "complete";

  // Deliberately no owner email here: this endpoint is public.
  return {
    needsSetup,
    setupLocked: row.status === "complete",
    isConfigured,
    status: row.status,
  };
}

setupRoutes.get("/status", async (c) => {
  const state = await getInstallationState(c.env.DB);
  return c.json(mapInstallationStatus(state, c.env));
});

setupRoutes.post("/complete", rateLimit(RATE_LIMITS.setup), async (c) => {
  // Once setup is complete, every call gets the same answer regardless of
  // the supplied secret, so the endpoint cannot be used as a secret oracle.
  const state = await getInstallationState(c.env.DB);

  if (state.status === "complete") {
    return c.json({ error: "Setup has already been completed" }, 409);
  }

  if (!c.env.OWNER_EMAIL || !c.env.SETUP_SECRET) {
    return c.json(
      {
        error:
          "Setup is unavailable until OWNER_EMAIL and SETUP_SECRET are configured",
      },
      503,
    );
  }

  const body = await parseJsonBody(c, setupSchema);
  if (!body.ok) return body.response;
  const payload = body.data;

  const requestedEmail = payload.email;
  const ownerEmail = normalizeEmail(c.env.OWNER_EMAIL);

  if (!(await secretsEqual(payload.setupSecret, c.env.SETUP_SECRET))) {
    return c.json({ error: "Invalid setup secret" }, 403);
  }

  if (requestedEmail !== ownerEmail) {
    return c.json({ error: "Setup email must match OWNER_EMAIL" }, 403);
  }

  const householdSlug = payload.householdSlug;

  const claimed = await beginInstallationSetup(c.env.DB);

  if (!claimed) {
    return c.json(
      { error: "Setup is already in progress or has been completed" },
      409,
    );
  }

  // Recover from an interrupted earlier attempt: a user for OWNER_EMAIL may
  // already exist without the installation ever being marked complete.
  const existingOwner = await findUserByEmail(c.env.DB, requestedEmail);

  if (existingOwner) {
    const ownedHouseholds = (
      await listHouseholdsForUser(c.env.DB, existingOwner.id)
    ).filter((household) => household.role === "owner");

    if (ownedHouseholds.length > 0) {
      // Sign-up and household creation both succeeded last time; only the
      // final bookkeeping step was lost. Finish it and tell the caller.
      await completeInstallationSetup(
        c.env.DB,
        existingOwner.id,
        requestedEmail,
      );
      logEvent("warn", "setup_recovered_existing_owner", {
        userId: existingOwner.id,
      });
      return c.json(
        {
          error:
            "Setup has already been completed for this owner. Sign in with your owner account.",
        },
        409,
      );
    }

    // Orphan from a failed attempt (no memberships): remove it so the retry
    // starts from a clean slate.
    logEvent("warn", "setup_orphan_user_removed", {
      userId: existingOwner.id,
    });
    await deleteUserById(c.env.DB, existingOwner.id);
  }

  const auth = provisioningAuthForEnv(c.env);
  let createdUserId: string | null = null;

  try {
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: requestedEmail,
        name: payload.name,
        password: payload.password,
      },
      headers: new Headers(c.req.raw.headers),
      returnHeaders: true,
    });

    const createdUser = signUpResult.response.user;
    createdUserId = createdUser.id;

    const household = await createHousehold(c.env.DB, {
      slug: householdSlug,
      displayName: payload.householdName,
      ownerUserId: createdUser.id,
    });

    await completeInstallationSetup(c.env.DB, createdUser.id, requestedEmail);
    await recordAuditEvent(c.env.DB, {
      actorUserId: createdUser.id,
      householdId: household?.id ?? null,
      action: "installation.setup_completed",
      targetType: "installation",
      targetId: "1",
      details: { householdSlug },
    });

    const response = c.json(
      {
        member: {
          id: createdUser.id,
          email: createdUser.email,
          name: createdUser.name,
          role: "owner",
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
    logEvent("error", "setup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Compensate: remove the owner user created in this attempt so the next
    // attempt does not fail with USER_ALREADY_EXISTS, then release the claim.
    if (createdUserId) {
      await deleteUserById(c.env.DB, createdUserId).catch((cleanupError) => {
        logEvent("error", "setup_cleanup_failed", {
          userId: createdUserId,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      });
    }

    await resetInstallationSetup(c.env.DB);

    if (isUniqueViolation(error)) {
      return c.json(
        { error: "A household with that slug already exists" },
        409,
      );
    }

    if (isAPIError(error)) {
      const status = typeof error.status === "number" ? error.status : 400;

      return new Response(JSON.stringify({ error: error.message }), {
        status,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return c.json({ error: "Unable to complete setup" }, 500);
  }
});
