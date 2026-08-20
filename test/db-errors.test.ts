import { describe, expect, it } from "vitest";

import {
  isUniqueViolation,
  uniqueViolationTarget,
  unwrapDatabaseError,
} from "../src/server/db/errors";

describe("database error helpers", () => {
  it("recognises UNIQUE violations anywhere in the cause chain", () => {
    const inner = new Error(
      "D1_ERROR: UNIQUE constraint failed: households.slug: SQLITE_CONSTRAINT",
    );
    const wrapped = new Error("Failed query: insert …", { cause: inner });

    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(uniqueViolationTarget(wrapped)).toBe("households.slug");
    expect(unwrapDatabaseError(wrapped)).toBe(inner);
    expect(isUniqueViolation(new Error("database unavailable"))).toBe(false);
    expect(isUniqueViolation("nope")).toBe(false);
  });
});
