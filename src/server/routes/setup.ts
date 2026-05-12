import { isAPIError } from "better-auth/api";
import { Hono } from "hono";

import { provisioningAuthForEnv } from "../auth/auth";
import { createHousehold } from "../db/repositories/households";
import {
  beginInstallationSetup,
  completeInstallationSetup,
  getInstallationState,
  resetInstallationSetup,
} from "../db/repositories/installation-state";

type SetupPayload = {
  email?: string;
  name?: string;
  password?: string;
  householdName?: string;
  householdSlug?: string;
  setupSecret?: string;
};

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

  return {
    needsSetup,
    setupLocked: row.status === "complete",
    isConfigured,
    status: row.status,
    ownerEmail: row.owner_email,
  };
}

function normalizeSlug(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

setupRoutes.get("/status", async (c) => {
  const state = await getInstallationState(c.env.DB);
  return c.json(mapInstallationStatus(state, c.env));
});

setupRoutes.post("/complete", async (c) => {
  if (!c.env.OWNER_EMAIL || !c.env.SETUP_SECRET) {
    return c.json(
      {
        error:
          "Setup is unavailable until OWNER_EMAIL and SETUP_SECRET are configured",
      },
      503,
    );
  }

  let payload: SetupPayload;

  try {
    payload = await c.req.json<SetupPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (
    !payload.email ||
    !payload.name ||
    !payload.password ||
    !payload.householdName ||
    !payload.householdSlug ||
    !payload.setupSecret
  ) {
    return c.json(
      {
        error:
          "email, name, password, householdName, householdSlug, and setupSecret are required",
      },
      400,
    );
  }

  const requestedEmail = normalizeEmail(payload.email);
  const ownerEmail = normalizeEmail(c.env.OWNER_EMAIL);

  if (payload.setupSecret !== c.env.SETUP_SECRET) {
    return c.json({ error: "Invalid setup secret" }, 403);
  }

  if (requestedEmail !== ownerEmail) {
    return c.json({ error: "Setup email must match OWNER_EMAIL" }, 403);
  }

  if (payload.password.length < 12) {
    return c.json({ error: "Password must be at least 12 characters" }, 400);
  }

  const householdSlug = normalizeSlug(payload.householdSlug);

  if (!/^[a-z0-9-]+$/.test(householdSlug)) {
    return c.json(
      {
        error:
          "householdSlug may only contain lowercase letters, numbers, and hyphens",
      },
      400,
    );
  }

  const state = await getInstallationState(c.env.DB);

  if (state.status === "complete") {
    return c.json({ error: "Setup has already been completed" }, 409);
  }

  const claimed = await beginInstallationSetup(c.env.DB);

  if (!claimed) {
    return c.json(
      { error: "Setup is already in progress or has been completed" },
      409,
    );
  }

  const auth = provisioningAuthForEnv(c.env);

  try {
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: requestedEmail,
        name: payload.name.trim(),
        password: payload.password,
      },
      headers: new Headers(c.req.raw.headers),
      returnHeaders: true,
    });

    const createdUser = signUpResult.response.user;

    const household = await createHousehold(c.env.DB, {
      slug: householdSlug,
      displayName: payload.householdName.trim(),
      ownerUserId: createdUser.id,
    });

    await completeInstallationSetup(c.env.DB, createdUser.id, requestedEmail);

    const response = c.json(
      {
        member: {
          id: createdUser.id,
          email: createdUser.email,
          name: createdUser.name,
          role: "owner",
        },
        household,
        session: signUpResult.response,
      },
      201,
    );

    for (const cookie of signUpResult.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }

    return response;
  } catch (error) {
    console.error("Setup completion failed:", error);

    await resetInstallationSetup(c.env.DB);

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
