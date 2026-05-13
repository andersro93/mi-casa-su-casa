import { sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import type { MemberAccessRow, MemberRecord, ProviderRow } from "../types";

function normalizeTimestamp(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  return value ?? new Date(0).toISOString();
}

export async function listMembers(
  db: D1Database,
  householdId: string,
): Promise<MemberRecord[]> {
  const result = await dbForDatabase(db).all<{
    id: string;
    householdRole: "owner" | "member";
    email: string;
    name: string;
    role: string | null;
    createdAt: number | string;
    updatedAt: number | string;
  }>(sql`
    SELECT user.id,
           household_memberships.role AS householdRole,
           user.email,
           user.name,
           user.role,
           user.createdAt,
           user.updatedAt
    FROM household_memberships
    INNER JOIN user ON user.id = household_memberships.user_id
    WHERE household_memberships.household_id = ${householdId}
    ORDER BY user.createdAt ASC
  `);

  return result.map((member) => ({
    ...member,
    createdAt: normalizeTimestamp(member.createdAt),
    updatedAt: normalizeTimestamp(member.updatedAt),
  }));
}

export async function listMemberProviderAccess(
  db: D1Database,
  householdId: string,
): Promise<MemberAccessRow[]> {
  const result = await dbForDatabase(db).all<MemberAccessRow>(sql`
    SELECT user.id,
            household_memberships.role AS household_role,
            user.email,
            user.name,
            user.role,
            providers.provider_key,
            providers.display_name AS provider_display_name
    FROM household_memberships
    INNER JOIN user ON user.id = household_memberships.user_id
    LEFT JOIN household_member_provider_access
      ON household_member_provider_access.household_membership_id = household_memberships.id
    LEFT JOIN providers ON providers.id = household_member_provider_access.provider_id
    WHERE household_memberships.household_id = ${householdId}
    ORDER BY user.createdAt ASC, providers.display_name ASC
  `);

  return result;
}

export async function listProviders(
  db: D1Database,
  householdId: string,
): Promise<ProviderRow[]> {
  const result = await dbForDatabase(db).all<ProviderRow>(sql`
    SELECT id, household_id, provider_key, display_name
    FROM providers
    WHERE household_id = ${householdId}
    ORDER BY display_name ASC
  `);

  return result;
}

export async function grantProviderAccess(
  db: D1Database,
  householdId: string,
  userId: string,
  providerId: string,
) {
  await dbForDatabase(db).run(sql`
    INSERT OR IGNORE INTO household_member_provider_access (id, household_membership_id, provider_id)
    SELECT ${crypto.randomUUID()}, household_memberships.id, ${providerId}
    FROM household_memberships
    WHERE household_memberships.household_id = ${householdId}
      AND household_memberships.user_id = ${userId}
  `);
}

export async function revokeProviderAccess(
  db: D1Database,
  householdId: string,
  userId: string,
  providerId: string,
) {
  await dbForDatabase(db).run(sql`
    DELETE FROM household_member_provider_access
    WHERE provider_id = ${providerId}
      AND household_membership_id IN (
        SELECT id
        FROM household_memberships
        WHERE household_id = ${householdId} AND user_id = ${userId}
      )
  `);
}
