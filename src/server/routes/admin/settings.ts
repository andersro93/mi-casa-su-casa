import { Hono } from "hono";

import type { AppVariables } from "../../auth/middleware";
import { listAuditEvents } from "../../db/repositories/audit";
import {
  getHouseholdSettings,
  updateHouseholdDisplayName,
} from "../../db/repositories/households";
import { householdSettingsSchema } from "../../http/schemas";
import { parseJsonBody } from "../../http/validation";
import { audit } from "./audit";

function householdSettingsPayload(
  env: Env,
  settings: { slug: string; displayName: string },
) {
  const domain = env.EMAIL_DOMAIN?.trim();
  return {
    slug: settings.slug,
    displayName: settings.displayName,
    // The address providers must send codes to; null until EMAIL_DOMAIN is set.
    emailAddress: domain ? `${settings.slug}@${domain}` : null,
  };
}

export const settingsRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

settingsRoutes.get("/:slug/audit", async (c) => {
  const household = c.get("household");
  if (!household) return c.json({ error: "Forbidden" }, 403);
  const events = await listAuditEvents(c.env.DB, household.id);
  return c.json({ events });
});

settingsRoutes.get("/:slug/settings", async (c) => {
  const household = c.get("household");

  if (!household) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const settings = await getHouseholdSettings(c.env.DB, household.id);

  if (!settings) {
    return c.json({ error: "Household not found" }, 404);
  }

  return c.json({ household: householdSettingsPayload(c.env, settings) });
});

settingsRoutes.patch("/:slug/settings", async (c) => {
  const household = c.get("household");

  if (!household) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await parseJsonBody(c, householdSettingsSchema);
  if (!body.ok) return body.response;
  const { displayName } = body.data;

  const settings = await updateHouseholdDisplayName(
    c.env.DB,
    household.id,
    displayName,
  );

  if (!settings) {
    return c.json({ error: "Household not found" }, 404);
  }

  await audit(c, "household.settings_updated", "household", household.id, {
    displayName,
  });

  return c.json({ household: householdSettingsPayload(c.env, settings) });
});
