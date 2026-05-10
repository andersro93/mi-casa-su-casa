import type { MemberAccessRow, MemberRecord, ProviderRow } from "../types";

export async function listMembers(db: D1Database): Promise<MemberRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, email, name, role, createdAt, updatedAt
       FROM user
       ORDER BY createdAt ASC`,
    )
    .run<MemberRecord>();

  return result.results ?? [];
}

export async function listMemberProviderAccess(
  db: D1Database,
): Promise<MemberAccessRow[]> {
  const result = await db
    .prepare(
      `SELECT user.id,
              user.email,
              user.name,
              user.role,
              providers.provider_key,
              providers.display_name AS provider_display_name
       FROM user
       LEFT JOIN user_provider_access ON user_provider_access.user_id = user.id
       LEFT JOIN providers ON providers.id = user_provider_access.provider_id
       ORDER BY user.createdAt ASC, providers.display_name ASC`,
    )
    .run<MemberAccessRow>();

  return result.results ?? [];
}

export async function listProviders(db: D1Database): Promise<ProviderRow[]> {
  const result = await db
    .prepare(
      `SELECT id, provider_key, display_name
       FROM providers
       ORDER BY display_name ASC`,
    )
    .run<ProviderRow>();

  return result.results ?? [];
}

export async function grantProviderAccess(
  db: D1Database,
  userId: string,
  providerId: string,
) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_provider_access (id, user_id, provider_id)
       VALUES (?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), userId, providerId)
    .run();
}

export async function revokeProviderAccess(
  db: D1Database,
  userId: string,
  providerId: string,
) {
  await db
    .prepare(
      `DELETE FROM user_provider_access
       WHERE user_id = ? AND provider_id = ?`,
    )
    .bind(userId, providerId)
    .run();
}
