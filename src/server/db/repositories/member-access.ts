import { sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import type { MemberAccessRow, MemberRecord, ProviderRow } from "../types";

function normalizeTimestamp(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  return value ?? new Date(0).toISOString();
}

export async function listMembers(db: D1Database): Promise<MemberRecord[]> {
  const result = await dbForDatabase(db).all<{
    id: string;
    email: string;
    name: string;
    role: string | null;
    createdAt: number | string;
    updatedAt: number | string;
  }>(sql`
    SELECT id, email, name, role, createdAt, updatedAt
    FROM user
    ORDER BY createdAt ASC
  `);

  return result.map((member) => ({
    ...member,
    createdAt: normalizeTimestamp(member.createdAt),
    updatedAt: normalizeTimestamp(member.updatedAt),
  }));
}

export async function listMemberProviderAccess(
  db: D1Database,
): Promise<MemberAccessRow[]> {
  const result = await dbForDatabase(db).all<MemberAccessRow>(sql`
    SELECT user.id,
            user.email,
            user.name,
            user.role,
            providers.provider_key,
            providers.display_name AS provider_display_name
    FROM user
    LEFT JOIN user_provider_access ON user_provider_access.user_id = user.id
    LEFT JOIN providers ON providers.id = user_provider_access.provider_id
    ORDER BY user.createdAt ASC, providers.display_name ASC
  `);

  return result;
}

export async function listProviders(db: D1Database): Promise<ProviderRow[]> {
  const result = await dbForDatabase(db).all<ProviderRow>(sql`
    SELECT id, provider_key, display_name
    FROM providers
    ORDER BY display_name ASC
  `);

  return result;
}

export async function grantProviderAccess(
  db: D1Database,
  userId: string,
  providerId: string,
) {
  await dbForDatabase(db).run(sql`
    INSERT OR IGNORE INTO user_provider_access (id, user_id, provider_id)
    VALUES (${crypto.randomUUID()}, ${userId}, ${providerId})
  `);
}

export async function revokeProviderAccess(
  db: D1Database,
  userId: string,
  providerId: string,
) {
  await dbForDatabase(db).run(sql`
    DELETE FROM user_provider_access
    WHERE user_id = ${userId} AND provider_id = ${providerId}
  `);
}
