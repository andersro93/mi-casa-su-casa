import { describe, expect, it } from "vitest";

import { secretsEqual } from "../src/server/security/compare";

describe("secretsEqual", () => {
  it("compares secrets regardless of length differences", async () => {
    await expect(secretsEqual("correct horse", "correct horse")).resolves.toBe(
      true,
    );
    await expect(secretsEqual("correct horse", "correct horsf")).resolves.toBe(
      false,
    );
    await expect(secretsEqual("short", "a much longer secret")).resolves.toBe(
      false,
    );
    await expect(secretsEqual("", "")).resolves.toBe(true);
  });
});
