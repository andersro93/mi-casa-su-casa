import * as schema from "@server/db/schema";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { db } from "./helpers";

/**
 * The hand-written SQL migrations are the source of truth for the database.
 * `schema.ts` must mirror them exactly: Better Auth validates writes against
 * the Drizzle schema, and drift there has already caused production 500s.
 */

type ColumnInfo = {
  name: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};
type IndexInfo = { name: string; unique: number; origin: string };

const IGNORED_TABLES = new Set(["d1_migrations"]);

async function dbTables(): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'",
    )
    .all<{ name: string }>();
  return result.results
    .map((row) => row.name)
    .filter((n) => !IGNORED_TABLES.has(n));
}

async function dbColumns(table: string): Promise<ColumnInfo[]> {
  return (await db.prepare(`PRAGMA table_info("${table}")`).all<ColumnInfo>())
    .results;
}

async function dbIndexes(table: string) {
  const list = (
    await db.prepare(`PRAGMA index_list("${table}")`).all<IndexInfo>()
  ).results;
  const detailed = [];
  for (const index of list) {
    const cols = (
      await db
        .prepare(`PRAGMA index_info("${index.name}")`)
        .all<{ name: string }>()
    ).results.map((c) => c.name);
    detailed.push({ ...index, columns: cols });
  }
  return detailed;
}

function columnSetKey(columns: string[]) {
  return [...columns].sort().join(",");
}

const schemaTables = (Object.values(schema) as unknown[]).filter(
  (value): value is SQLiteTable => is(value, SQLiteTable),
);

describe("schema.ts mirrors the migrated database", () => {
  it("declares exactly the tables that exist", async () => {
    const declared = schemaTables.map((t) => getTableConfig(t).name).sort();
    const actual = (await dbTables()).sort();
    expect(declared).toEqual(actual);
  });

  for (const table of schemaTables) {
    const config = getTableConfig(table);

    describe(config.name, () => {
      it("has the same columns, nullability and defaults", async () => {
        const actual = await dbColumns(config.name);
        const actualByName = new Map(actual.map((c) => [c.name, c]));

        expect(config.columns.map((c) => c.name).sort()).toEqual(
          actual.map((c) => c.name).sort(),
        );

        for (const column of config.columns) {
          const real = actualByName.get(column.name);
          expect(real, `column ${config.name}.${column.name}`).toBeDefined();
          if (!real) continue;

          if (!column.primary) {
            expect(
              Boolean(real.notnull),
              `${config.name}.${column.name} NOT NULL`,
            ).toBe(column.notNull);
          }
          if (!column.primary) {
            expect(
              real.dflt_value !== null,
              `${config.name}.${column.name} DEFAULT`,
            ).toBe(column.hasDefault);
          }
        }
      });

      it("has the same unique constraints and indexes", async () => {
        const actual = await dbIndexes(config.name);

        // Unique: inline UNIQUE(...) constraints (autoindex, origin 'u'),
        // column-level UNIQUE, and CREATE UNIQUE INDEX — compared by column set.
        const actualUnique = new Set(
          actual
            .filter((i) => i.unique === 1 && i.origin !== "pk")
            .map((i) => columnSetKey(i.columns)),
        );
        const declaredUnique = new Set<string>([
          ...config.uniqueConstraints.map((u) =>
            columnSetKey(u.columns.map((c) => c.name)),
          ),
          ...config.indexes
            .filter((i) => i.config.unique)
            .map((i) =>
              columnSetKey(
                i.config.columns.map((c) =>
                  "name" in c ? String(c.name) : String(c),
                ),
              ),
            ),
          ...config.columns
            .filter((c) => c.isUnique)
            .map((c) => columnSetKey([c.name])),
        ]);
        expect([...declaredUnique].sort(), "unique column sets").toEqual(
          [...actualUnique].sort(),
        );

        // Non-unique indexes: compared by name + columns.
        const actualPlain = actual
          .filter((i) => i.unique === 0)
          .map((i) => `${i.name}(${i.columns.join(",")})`)
          .sort();
        const declaredPlain = config.indexes
          .filter((i) => !i.config.unique)
          .map(
            (i) =>
              `${i.config.name}(${i.config.columns
                .map((c) => ("name" in c ? String(c.name) : String(c)))
                .join(",")})`,
          )
          .sort();
        expect(declaredPlain, "indexes").toEqual(actualPlain);
      });
    });
  }
});
