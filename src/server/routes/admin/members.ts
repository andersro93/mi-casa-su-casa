import { Hono } from "hono";

import type { AppVariables } from "../../auth/middleware";
import {
  countHouseholdOwners,
  getHouseholdMembership,
  removeUserFromHousehold,
  updateHouseholdMembershipRole,
} from "../../db/repositories/households";
import {
  grantProviderAccess,
  revokeProviderAccess,
} from "../../db/repositories/member-access";
import { getProviderByKey } from "../../db/repositories/provider-rules";
import { providerAccessSchema, roleChangeSchema } from "../../http/schemas";
import { parseJsonBody } from "../../http/validation";
import { logEvent } from "../../runtime/log";
import { audit } from "./audit";

export const membersRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

membersRoutes.delete("/:slug/members/:userId", async (c) => {
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

membersRoutes.patch("/:slug/members/:userId/role", async (c) => {
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

membersRoutes.post("/:slug/members/:userId/provider-access", async (c) => {
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

membersRoutes.delete(
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
