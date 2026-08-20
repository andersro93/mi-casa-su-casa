import { describe, expect, it } from "vitest";

import {
  normalizeHouseholdSlug,
  validateHouseholdSlug,
} from "../src/server/domain/household-slug";

describe("household slug validation", () => {
  it("accepts ordinary slugs", () => {
    for (const slug of ["casa", "smith-family", "home2", "ab"]) {
      expect(validateHouseholdSlug(slug)).toEqual({ ok: true });
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
      "-casa",
      "casa-",
      "Casa",
      "ca sa",
      "a",
      "x".repeat(41),
      "",
    ]) {
      expect(validateHouseholdSlug(slug).ok, slug).toBe(false);
    }
  });

  it("normalises case and whitespace", () => {
    expect(normalizeHouseholdSlug("  Casa ")).toBe("casa");
  });
});
