import { Hono } from "hono";

import {
  type AppVariables,
  requireAuthenticatedUser,
  requireHouseholdContext,
} from "../auth/middleware";
import { recordAuditEvent } from "../db/repositories/audit";
import {
  countHouseholdOwners,
  createHousehold,
  getHouseholdBySlug,
  listHouseholdsForUser,
  removeUserFromHousehold,
} from "../db/repositories/households";
import { getInstallationState } from "../db/repositories/installation-state";
import { createHouseholdSchema } from "../http/schemas";
import { parseJsonBody } from "../http/validation";
import { logEvent } from "../runtime/log";
import { RATE_LIMITS, rateLimit } from "../security/rate-limit";

/**
 * Who may create households: the installation owner and app-level admins
 * always; anyone else only when they belong to no household yet (so a user
 * whose only household was removed can recover). Invited members cannot
 * mint extra households or squat inbound addresses.
 */
async function mayCreateHousehold(
  db: D1Database,
  user: { id: string; role: string },
): Promise<boolean> {
  if (user.role === "admin") {
    return true;
  }
  const installation = await getInstallationState(db);
  if (installation.owner_user_id === user.id) {
    return true;
  }
  const memberships = await listHouseholdsForUser(db, user.id);
  return memberships.length === 0;
}

export const householdRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

householdRoutes.use("*", requireAuthenticatedUser);

householdRoutes.get("/me", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({ households: await listHouseholdsForUser(c.env.DB, user.id) });
});

householdRoutes.post("/", rateLimit(RATE_LIMITS.householdCreate), async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await parseJsonBody(c, createHouseholdSchema);
  if (!body.ok) return body.response;
  const { slug, displayName } = body.data;

  if (!(await mayCreateHousehold(c.env.DB, user))) {
    return c.json(
      {
        error:
          "Only the installation owner can create additional households. Ask them to create it and invite you.",
      },
      403,
    );
  }

  const existing = await getHouseholdBySlug(c.env.DB, slug);

  if (existing) {
    return c.json({ error: "Household slug already exists" }, 409);
  }

  const household = await createHousehold(c.env.DB, {
    slug,
    displayName,
    ownerUserId: user.id,
  });

  if (!household) {
    return c.json({ error: "Unable to create household" }, 500);
  }

  await recordAuditEvent(c.env.DB, {
    actorUserId: user.id,
    householdId: household.id,
    action: "household.created",
    targetType: "household",
    targetId: household.id,
    details: { slug },
  });

  // Same shape as /api/households/me entries so the client can use it directly.
  return c.json({ household: { ...household, role: "owner" as const } }, 201);
});

householdRoutes.post("/:slug/leave", requireHouseholdContext, async (c) => {
  const user = c.get("user");
  const household = c.get("household");

  if (!user || !household) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (
    household.role === "owner" &&
    (await countHouseholdOwners(c.env.DB, household.id)) <= 1
  ) {
    return c.json(
      {
        error:
          "You are the only owner of this household. Make another member an owner first.",
      },
      409,
    );
  }

  await removeUserFromHousehold(c.env.DB, {
    householdId: household.id,
    userId: user.id,
  });
  logEvent("info", "member_left", {
    householdId: household.id,
    userId: user.id,
  });
  await recordAuditEvent(c.env.DB, {
    actorUserId: user.id,
    householdId: household.id,
    action: "member.left",
    targetType: "user",
    targetId: user.id,
  });

  return c.json({ ok: true });
});
