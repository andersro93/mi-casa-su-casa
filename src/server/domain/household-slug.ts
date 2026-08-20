/**
 * Household slugs double as URL path segments and inbound email local parts,
 * so they must not collide with app routes or look like system mailboxes.
 */
export const RESERVED_HOUSEHOLD_SLUGS = new Set([
  "api",
  "admin",
  "assets",
  "cdn-cgi",
  "favicon.ico",
  "forgot-password",
  "health",
  "households",
  "household",
  "inbox",
  "invite",
  "invitations",
  "login",
  "logout",
  "members",
  "new-household",
  "postmaster",
  "providers",
  "quarantine",
  "reset-password",
  "settings",
  "setup",
  "static",
  "two-factor",
  "abuse",
  "noreply",
  "no-reply",
  "hostmaster",
  "webmaster",
]);

export const HOUSEHOLD_SLUG_MIN_LENGTH = 2;
export const HOUSEHOLD_SLUG_MAX_LENGTH = 40;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type SlugValidation = { ok: true } | { ok: false; error: string };

export function normalizeHouseholdSlug(value: string | undefined | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function validateHouseholdSlug(slug: string): SlugValidation {
  if (!slug) {
    return { ok: false, error: "slug is required" };
  }
  if (
    slug.length < HOUSEHOLD_SLUG_MIN_LENGTH ||
    slug.length > HOUSEHOLD_SLUG_MAX_LENGTH
  ) {
    return {
      ok: false,
      error: `slug must be between ${HOUSEHOLD_SLUG_MIN_LENGTH} and ${HOUSEHOLD_SLUG_MAX_LENGTH} characters`,
    };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error:
        "slug may only contain lowercase letters, numbers, and hyphens, and must start and end with a letter or number",
    };
  }
  if (RESERVED_HOUSEHOLD_SLUGS.has(slug)) {
    return {
      ok: false,
      error: `"${slug}" is reserved and cannot be used as a household slug`,
    };
  }
  return { ok: true };
}
