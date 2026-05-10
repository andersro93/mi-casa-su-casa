import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export function dbForDatabase(database: D1Database) {
  return drizzle(database, { schema });
}

export function dbForEnv(env: Pick<Env, "DB">) {
  return dbForDatabase(env.DB);
}

export type AppDatabase = ReturnType<typeof dbForDatabase>;
