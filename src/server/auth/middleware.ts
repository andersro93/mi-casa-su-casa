import type { MiddlewareHandler } from "hono";
import {
  listHouseholdsForUser,
  userBelongsToHousehold,
} from "../db/repositories/households";
import { authForEnv } from "./auth";
import type { AuthContext } from "./auth-context";

export type AppVariables = AuthContext;

export const loadAuthSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: AppVariables;
}> = async (c, next) => {
  const auth = authForEnv(c.env);
  const result = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  const role =
    typeof result?.user?.role === "string" ? result.user.role : "user";
  const households = result?.user
    ? await listHouseholdsForUser(c.env.DB, result.user.id)
    : [];

  c.set(
    "user",
    result?.user
      ? {
          id: result.user.id,
          email: result.user.email,
          name:
            typeof result.user.name === "string" && result.user.name.trim()
              ? result.user.name.trim()
              : result.user.email,
          role,
          households,
        }
      : null,
  );
  c.set(
    "session",
    result?.session
      ? {
          id: result.session.id,
          userId: result.session.userId,
        }
      : null,
  );
  c.set("household", null);

  await next();
};

export const requireAuthenticatedUser: MiddlewareHandler<{
  Bindings: Env;
  Variables: AppVariables;
}> = async (c, next) => {
  if (!c.get("user")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};

export const requireOwner: MiddlewareHandler<{
  Bindings: Env;
  Variables: AppVariables;
}> = async (c, next) => {
  const household = c.get("household");

  if (!household || household.role !== "owner") {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
};

export const requireHouseholdContext: MiddlewareHandler<{
  Bindings: Env;
  Variables: AppVariables;
}> = async (c, next) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const slug = c.req.param("slug");

  if (!slug) {
    return c.json({ error: "Household slug is required" }, 400);
  }

  const membership = await userBelongsToHousehold(c.env.DB, user.id, slug);

  if (!membership) {
    return c.json({ error: "Forbidden" }, 403);
  }

  c.set("household", {
    id: membership.householdId,
    slug: membership.slug,
    role: membership.role,
  });

  await next();
};
