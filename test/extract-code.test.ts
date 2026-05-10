import { describe, expect, it } from "vitest";

import { extractVerificationCode } from "../src/server/domain/extract-code";

describe("extractVerificationCode", () => {
  it("extracts keyword-based codes", () => {
    expect(extractVerificationCode("Your verification code is 654321")).toBe(
      "654321",
    );
  });

  it("falls back to a standalone numeric code", () => {
    expect(extractVerificationCode("Use 112233 to finish signing in")).toBe(
      "112233",
    );
  });

  it("returns null when no code-like value is present", () => {
    expect(
      extractVerificationCode("Welcome back, there is nothing to verify here."),
    ).toBeNull();
  });
});
