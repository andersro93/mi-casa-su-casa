import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

import { resetDatabase } from "./helpers";

// Applies every checked-in D1 migration before each test file runs, so
// integration tests exercise the real schema, and empties the tables before
// each test so tests are independent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await resetDatabase();
});
