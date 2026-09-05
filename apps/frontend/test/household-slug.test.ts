/**
 * A drift guard for `src/lib/household-slug.ts`.
 *
 * The server owns this rule — `apps/server/internal/domain/slug.go` is what
 * actually decides, and `apps/server/internal/domain/slug_test.go` covers it
 * exhaustively. The SPA keeps a mirror so it can say no before a round trip,
 * and nothing mechanically ties the two together: this file is that tie, and
 * it deliberately repeats the Go test's assertions rather than deriving them,
 * so a change on either side has to be made on both.
 *
 * These cases are the deleted Workers-era `test/household-slug.test.ts`, plus
 * the reserved-set parity check the Go side has.
 */
import { describe, expect, it } from "vitest";

import {
  HOUSEHOLD_SLUG_MAX_LENGTH,
  HOUSEHOLD_SLUG_MIN_LENGTH,
  RESERVED_HOUSEHOLD_SLUGS,
  validateHouseholdSlug,
} from "@/lib/household-slug";

// Verbatim from TestReservedHouseholdSlugs in slug_test.go. The last two are
// the container's probe endpoints, which the Workers original never had.
const GO_RESERVED = [
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
  "healthz",
  "readyz",
];

/** The error text, or null when the slug is fine. */
function problem(slug: string): string | null {
  const result = validateHouseholdSlug(slug);
  return result.ok ? null : result.error;
}

describe("the reserved set", () => {
  it("holds exactly what the Go server reserves", () => {
    // Both directions: a missing name lets a slug through that the server
    // will reject with a confusing error, and an extra one refuses a slug
    // the server would have allowed.
    expect([...RESERVED_HOUSEHOLD_SLUGS].sort()).toEqual(
      [...GO_RESERVED].sort(),
    );
  });

  it("counts 31, the same as ReservedHouseholdSlugs in Go", () => {
    expect(RESERVED_HOUSEHOLD_SLUGS.size).toBe(31);
  });
});

describe("the length bounds", () => {
  it("matches HouseholdSlugMinLength and HouseholdSlugMaxLength", () => {
    expect(HOUSEHOLD_SLUG_MIN_LENGTH).toBe(2);
    expect(HOUSEHOLD_SLUG_MAX_LENGTH).toBe(40);
  });
});

describe("household slug validation", () => {
  it("accepts ordinary slugs", () => {
    for (const slug of ["casa", "smith-family", "home2", "ab"]) {
      expect(validateHouseholdSlug(slug), slug).toEqual({ ok: true });
    }
  });

  it("rejects reserved, malformed and oversized slugs", () => {
    for (const slug of [
      "members",
      "settings",
      "api",
      "invite",
      "two-factor",
      "postmaster",
      "healthz",
      "readyz",
      "-casa",
      "casa-",
      "Casa",
      "ca sa",
      "a",
      "x".repeat(HOUSEHOLD_SLUG_MAX_LENGTH + 1),
      "",
    ]) {
      expect(validateHouseholdSlug(slug).ok, slug).toBe(false);
    }
  });

  it("explains each failure the way the server does", () => {
    // The strings are the Go sentinels' Error() texts verbatim: the SPA
    // renders whichever side produced them without translating, so they must
    // not diverge.
    expect(problem("")).toBe("slug is required");
    expect(problem("a")).toBe("slug must be between 2 and 40 characters");
    expect(problem("x".repeat(41))).toBe(
      "slug must be between 2 and 40 characters",
    );
    expect(problem("Casa")).toBe(
      "slug may only contain lowercase letters, numbers, and hyphens, and must start and end with a letter or number",
    );
    expect(problem("members")).toBe(
      '"members" is reserved and cannot be used as a household slug',
    );
  });

  it("checks the pattern before the reserved set", () => {
    // "API" is reserved once normalised, but validation deliberately does not
    // normalise — the caller does. So it fails on the characters, with the
    // message that names the real problem.
    expect(problem("API")).toContain("lowercase");
  });
});
