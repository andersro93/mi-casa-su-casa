import type { MiddlewareHandler } from "hono";
import { authForEnv } from "./auth";
import type { AuthContext } from "./auth-context";

export type AppVariables = AuthContext;

export const loadAuthSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: AppVariables;
}> = async (c, next) => {
  const result = await authForEnv(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  const role =
    typeof result?.user?.role === "string" ? result.user.role : "member";

  c.set(
    "user",
    result?.user
      ? {
          id: result.user.id,
          email: result.user.email,
          role,
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
  const user = c.get("user");

  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
};
