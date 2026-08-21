import { Hono } from "hono";

import {
  type AppVariables,
  requireHouseholdContext,
  requireOwner,
} from "../../auth/middleware";
import { invitationsRoutes } from "./invitations";
import { membersRoutes } from "./members";
import { providersRoutes } from "./providers";
import { settingsRoutes } from "./settings";

/**
 * Owner-only household administration. Every sub-router is mounted under
 * /:slug and receives the resolved household + owner checks from here.
 */
export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

adminRoutes.use("/:slug/*", requireHouseholdContext);
adminRoutes.use("/:slug/*", requireOwner);

adminRoutes.route("/", settingsRoutes);
adminRoutes.route("/", providersRoutes);
adminRoutes.route("/", invitationsRoutes);
adminRoutes.route("/", membersRoutes);
