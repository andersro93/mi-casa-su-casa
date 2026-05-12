import { Hono } from "hono";

import {
  type AppVariables,
  requireAuthenticatedUser,
} from "../auth/middleware";
import {
  createHousehold,
  getHouseholdBySlug,
  listHouseholdsForUser,
} from "../db/repositories/households";

type CreateHouseholdPayload = {
  slug?: string;
  displayName?: string;
};

function normalizeSlug(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeDisplayName(value: string | undefined) {
  return value?.trim() ?? "";
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

householdRoutes.post("/", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let payload: CreateHouseholdPayload;

  try {
    payload = await c.req.json<CreateHouseholdPayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const slug = normalizeSlug(payload.slug);
  const displayName = normalizeDisplayName(payload.displayName);

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return c.json(
      { error: "slug is required and may only contain lowercase letters, numbers, and hyphens" },
      400,
    );
  }

  if (!displayName) {
    return c.json({ error: "displayName is required" }, 400);
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

  return c.json({ household }, 201);
});
