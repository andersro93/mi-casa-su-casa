import { Hono } from "hono";

import {
  type AppVariables,
  requireAuthenticatedUser,
} from "../auth/middleware";
import {
  deleteOtherSessions,
  deleteSessionById,
  getUserProfile,
  listUserSessions,
  updateUserProfile,
} from "../db/repositories/settings";

type ProfilePayload = {
  name?: string;
  image?: string | null;
};

export const settingsRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

settingsRoutes.use("*", requireAuthenticatedUser);

settingsRoutes.get("/", async (c) => {
  const currentUser = c.get("user");

  if (!currentUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const [profile, sessions] = await Promise.all([
    getUserProfile(c.env.DB, currentUser.id),
    listUserSessions(c.env.DB, currentUser.id),
  ]);

  if (!profile) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ profile, sessions });
});

settingsRoutes.get("/households", async (c) => {
  const currentUser = c.get("user");

  if (!currentUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({ households: currentUser.households });
});

settingsRoutes.patch("/profile", async (c) => {
  const currentUser = c.get("user");

  if (!currentUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let payload: ProfilePayload;

  try {
    payload = await c.req.json<ProfilePayload>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const name = payload.name?.trim() ?? "";
  const image = payload.image?.trim() ?? null;

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  const profile = await updateUserProfile(c.env.DB, currentUser.id, {
    name,
    image,
  });

  return c.json({ profile });
});

settingsRoutes.delete("/sessions/others", async (c) => {
  const currentUser = c.get("user");
  const currentSession = c.get("session");

  if (!currentUser || !currentSession) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await deleteOtherSessions(c.env.DB, currentUser.id, currentSession.id);
  return c.json({ ok: true });
});

settingsRoutes.delete("/sessions/:sessionId", async (c) => {
  const currentUser = c.get("user");
  const sessionId = c.req.param("sessionId");

  if (!currentUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await deleteSessionById(c.env.DB, currentUser.id, sessionId);
  return c.json({ ok: true });
});
