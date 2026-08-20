import { and, eq, ne, sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import { session, user } from "../schema";
import { listHouseholdsForUser } from "./households";

function normalizeTimestamp(value: Date | number | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

export async function getUserProfile(db: D1Database, userId: string) {
  const rows = await dbForDatabase(db)
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const profile = rows[0] ?? null;

  if (!profile) {
    return null;
  }

  return {
    ...profile,
    households: await listHouseholdsForUser(db, userId),
  };
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  profile: { name: string; image: string | null },
) {
  await dbForDatabase(db)
    .update(user)
    .set({
      name: profile.name,
      image: profile.image,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId));

  return getUserProfile(db, userId);
}

export async function listUserSessions(db: D1Database, userId: string) {
  const rows = await dbForDatabase(db)
    .select({
      id: session.id,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      impersonatedBy: session.impersonatedBy,
    })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(sql`${session.createdAt} DESC`);

  return rows.map((row) => ({
    id: row.id,
    expiresAt: normalizeTimestamp(row.expiresAt),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
    impersonatedBy: row.impersonatedBy,
  }));
}

export async function deleteSessionById(
  db: D1Database,
  userId: string,
  sessionId: string,
) {
  return dbForDatabase(db)
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)));
}

export async function deleteOtherSessions(
  db: D1Database,
  userId: string,
  currentSessionId: string,
) {
  return dbForDatabase(db)
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, currentSessionId)));
}
