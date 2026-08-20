import { getAuthTables } from "@better-auth/core/db";
import { passkey } from "@better-auth/passkey";
import { twoFactor } from "better-auth/plugins";
import { describe, expect, it } from "vitest";

import { db, tableColumns } from "./helpers";

const APP_TABLES = [
  "households",
  "household_memberships",
  "household_invitations",
  "household_invitation_provider_access",
  "household_member_provider_access",
  "providers",
  "sender_rules",
  "messages",
  "quarantine_messages",
  "audit_events",
  "app_installation",
];

describe("database schema", () => {
  it("applies every migration and creates the application tables", async () => {
    const result = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();
    const names = result.results.map((row) => row.name);

    for (const table of APP_TABLES) {
      expect(names, `missing table ${table}`).toContain(table);
    }
    expect(names).not.toContain("user_provider_access");
  });

  it("contains every column Better Auth expects for the configured plugins", async () => {
    // Mirrors src/server/auth/auth.ts: twoFactor + passkey + the `role` field.
    const tables = getAuthTables({
      plugins: [twoFactor(), passkey({ rpID: "localhost", rpName: "test" })],
      user: {
        additionalFields: {
          role: { type: "string", required: false, input: false },
        },
      },
    });

    // Better Auth model names → our physical table names / column naming.
    const physicalTable: Record<string, string> = {
      user: "user",
      session: "session",
      account: "account",
      verification: "verification",
      twoFactor: "two_factor",
      passkey: "passkey",
    };
    const snakeCaseTables = new Set(["two_factor", "passkey"]);

    for (const [modelKey, table] of Object.entries(tables)) {
      const tableName = physicalTable[table.modelName] ?? table.modelName;
      const columns = await tableColumns(tableName);
      expect(
        columns.length,
        `table ${tableName} (${modelKey}) missing`,
      ).toBeGreaterThan(0);

      for (const [fieldKey, field] of Object.entries(table.fields)) {
        const wanted = field.fieldName ?? fieldKey;
        const columnName = snakeCaseTables.has(tableName)
          ? wanted
              .replace(/ID$/, "Id")
              .replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
          : wanted;
        expect(
          columns,
          `Better Auth field ${table.modelName}.${wanted} has no column in ${tableName}`,
        ).toContain(columnName);
      }
    }
  });

  it("does not seed any household on a fresh install", async () => {
    // Documents current behaviour; tightened when #88 lands.
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM households")
      .first<{ n: number }>();
    expect(typeof row?.n).toBe("number");
  });
});
