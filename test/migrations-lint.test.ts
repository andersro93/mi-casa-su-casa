import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationsDir = new URL("../migrations/", import.meta.url);

/** 0005 predates this rule and happened to be safe (children dropped first). */
const GRANDFATHERED = new Set(["0005_multi_household_isolation.sql"]);

describe("migration files", () => {
  const files = readdirSync(migrationsDir).filter((name: string) =>
    name.endsWith(".sql"),
  );

  it("are numbered sequentially without gaps or duplicates", () => {
    const numbers = files
      .map((name: string) => Number(name.slice(0, 4)))
      .sort((a: number, b: number) => a - b);
    expect(numbers[0]).toBe(1);
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i], `after ${numbers[i - 1]}`).toBe(
        (numbers[i - 1] ?? 0) + 1,
      );
    }
  });

  it("never rely on PRAGMA foreign_keys or SQL transactions (D1 ignores/rejects them)", () => {
    for (const name of files) {
      if (GRANDFATHERED.has(name)) continue;
      const sql = readFileSync(new URL(name, migrationsDir), "utf8");
      expect(sql, name).not.toMatch(/PRAGMA\s+foreign_keys/i);
      expect(sql, name).not.toMatch(/^\s*(BEGIN|COMMIT)\b/im);
    }
  });
});
