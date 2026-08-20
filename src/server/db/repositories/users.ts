import { eq } from "drizzle-orm";

import { dbForDatabase } from "../client";
import { user } from "../schema";

export async function findUserByEmail(db: D1Database, email: string) {
  const rows = await dbForDatabase(db)
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Deletes a Better Auth user; accounts, sessions, passkeys and memberships
 * cascade via foreign keys. Only used to compensate for interrupted flows.
 */
export async function deleteUserById(db: D1Database, userId: string) {
  await dbForDatabase(db).delete(user).where(eq(user.id, userId));
}
