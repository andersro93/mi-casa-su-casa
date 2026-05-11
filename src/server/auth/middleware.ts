import type { MiddlewareHandler } from "hono";
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

  const storedRole =
    typeof result?.user?.role === "string" ? result.user.role : "user";
  let role = storedRole === "admin" ? "admin" : "member";

  if (
    result?.user &&
    c.env.OWNER_EMAIL &&
    result.user.email.toLowerCase() === c.env.OWNER_EMAIL.toLowerCase() &&
    storedRole !== "admin"
  ) {
    // Direct D1 update bypasses Better Auth admin plugin permission check.
    // The admin plugin's setRole API requires the *caller* to already be admin,
    // creating a chicken-and-egg problem for owner auto-promotion.
    await c.env.DB.prepare("UPDATE user SET role = 'admin' WHERE id = ?")
      .bind(result.user.id)
      .run();
    role = "admin";
  }

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
