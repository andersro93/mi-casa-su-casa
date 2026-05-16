import { and, eq, inArray, sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import {
  householdMemberships,
  households,
  providers,
  senderRules,
} from "../schema";

export type HouseholdMembershipRole = "owner" | "member";

export type HouseholdSummary = {
  id: string;
  slug: string;
  displayName: string;
  role: HouseholdMembershipRole;
};

export type HouseholdSettings = {
  id: string;
  slug: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export async function listHouseholdsForUser(
  db: D1Database,
  userId: string,
): Promise<HouseholdSummary[]> {
  return dbForDatabase(db)
    .select({
      id: households.id,
      slug: households.slug,
      displayName: households.displayName,
      role: householdMemberships.role,
    })
    .from(householdMemberships)
    .innerJoin(households, eq(households.id, householdMemberships.householdId))
    .where(eq(householdMemberships.userId, userId))
    .orderBy(sql`lower(${households.displayName}) asc`);
}

export async function getHouseholdMembership(
  db: D1Database,
  userId: string,
  householdId: string,
) {
  const rows = await dbForDatabase(db)
    .select({
      householdId: householdMemberships.householdId,
      userId: householdMemberships.userId,
      role: householdMemberships.role,
      slug: households.slug,
      displayName: households.displayName,
    })
    .from(householdMemberships)
    .innerJoin(households, eq(households.id, householdMemberships.householdId))
    .where(
      and(
        eq(householdMemberships.userId, userId),
        eq(householdMemberships.householdId, householdId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function getHouseholdBySlug(db: D1Database, slug: string) {
  const rows = await dbForDatabase(db)
    .select({
      id: households.id,
      slug: households.slug,
      displayName: households.displayName,
      createdAt: households.createdAt,
      updatedAt: households.updatedAt,
    })
    .from(households)
    .where(eq(households.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}

export async function getHouseholdById(db: D1Database, id: string) {
  const rows = await dbForDatabase(db)
    .select({
      id: households.id,
      slug: households.slug,
      displayName: households.displayName,
      createdAt: households.createdAt,
      updatedAt: households.updatedAt,
    })
    .from(households)
    .where(eq(households.id, id))
    .limit(1);

  return rows[0] ?? null;
}

export async function getHouseholdSettings(
  db: D1Database,
  householdId: string,
): Promise<HouseholdSettings | null> {
  const rows = await dbForDatabase(db)
    .select({
      id: households.id,
      slug: households.slug,
      displayName: households.displayName,
      createdAt: households.createdAt,
      updatedAt: households.updatedAt,
    })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);

  return rows[0] ?? null;
}

export async function createHousehold(
  db: D1Database,
  input: {
    slug: string;
    displayName: string;
    ownerUserId: string;
  },
) {
  const householdId = crypto.randomUUID();

  await dbForDatabase(db).transaction(async (tx) => {
    await tx.insert(households).values({
      id: householdId,
      slug: input.slug,
      displayName: input.displayName,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    });

    await tx.insert(householdMemberships).values({
      id: crypto.randomUUID(),
      householdId,
      userId: input.ownerUserId,
      role: "owner",
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    });
  });

  return getHouseholdBySlug(db, input.slug);
}

export async function updateHouseholdDisplayName(
  db: D1Database,
  householdId: string,
  displayName: string,
) {
  await dbForDatabase(db)
    .update(households)
    .set({
      displayName,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(households.id, householdId));

  return getHouseholdSettings(db, householdId);
}

export async function addUserToHousehold(
  db: D1Database,
  input: {
    householdId: string;
    userId: string;
    role: HouseholdMembershipRole;
  },
) {
  await dbForDatabase(db)
    .insert(householdMemberships)
    .values({
      id: crypto.randomUUID(),
      householdId: input.householdId,
      userId: input.userId,
      role: input.role,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .onConflictDoUpdate({
      target: [householdMemberships.householdId, householdMemberships.userId],
      set: {
        role: input.role,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
}

export async function updateHouseholdMembershipRole(
  db: D1Database,
  input: {
    householdId: string;
    userId: string;
    role: HouseholdMembershipRole;
  },
) {
  await dbForDatabase(db)
    .update(householdMemberships)
    .set({
      role: input.role,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(householdMemberships.householdId, input.householdId),
        eq(householdMemberships.userId, input.userId),
      ),
    );
}

export async function userBelongsToHousehold(
  db: D1Database,
  userId: string,
  householdSlug: string,
) {
  const rows = await dbForDatabase(db)
    .select({
      householdId: householdMemberships.householdId,
      role: householdMemberships.role,
      slug: households.slug,
    })
    .from(householdMemberships)
    .innerJoin(households, eq(households.id, householdMemberships.householdId))
    .where(
      and(
        eq(householdMemberships.userId, userId),
        eq(households.slug, householdSlug),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function assertProvidersBelongToHousehold(
  db: D1Database,
  householdId: string,
  providerIds: string[],
) {
  if (providerIds.length === 0) {
    return true;
  }

  const rows = await dbForDatabase(db)
    .select({ id: providers.id })
    .from(providers)
    .where(
      and(
        eq(providers.householdId, householdId),
        inArray(providers.id, providerIds),
      ),
    );

  return rows.length === providerIds.length;
}

export async function assertSenderRuleBelongsToHousehold(
  db: D1Database,
  householdId: string,
  ruleId: string,
) {
  const rows = await dbForDatabase(db)
    .select({ id: senderRules.id })
    .from(senderRules)
    .where(
      and(eq(senderRules.id, ruleId), eq(senderRules.householdId, householdId)),
    )
    .limit(1);

  return Boolean(rows[0]);
}
