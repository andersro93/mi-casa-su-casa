import { and, eq, inArray, sql } from "drizzle-orm";

import { type AppDatabase, dbForDatabase } from "../client";
import {
  householdInvitationProviderAccess,
  householdInvitations,
  householdMemberships,
  providers,
} from "../schema";

export type InvitationRole = "member" | "owner";
export type InvitationStatus = "pending" | "accepted" | "cancelled" | "expired";

export type InvitationRecord = {
  id: string;
  householdId: string;
  email: string;
  name: string;
  role: InvitationRole;
  status: InvitationStatus;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type InvitationWithProviderRow = InvitationRecord & {
  providerId: string | null;
  providerKey: string | null;
  providerDisplayName: string | null;
};

export async function createHouseholdInvitation(
  db: D1Database,
  input: {
    householdId: string;
    email: string;
    name: string;
    role: InvitationRole;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: string;
    providerIds: string[];
  },
) {
  const invitationId = crypto.randomUUID();
  const database = dbForDatabase(db);

  // D1 does not support SQL transactions (BEGIN/COMMIT); `batch` is atomic.
  await database.batch([
    database.insert(householdInvitations).values({
      id: invitationId,
      householdId: input.householdId,
      email: input.email,
      name: input.name,
      role: input.role,
      tokenHash: input.tokenHash,
      status: "pending",
      invitedByUserId: input.invitedByUserId,
      acceptedByUserId: null,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      cancelledAt: null,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }),
    ...invitationProviderInserts(database, invitationId, input.providerIds),
  ]);

  return invitationId;
}

export async function listHouseholdInvitations(
  db: D1Database,
  householdId?: string,
) {
  const rows = await dbForDatabase(db)
    .select({
      id: householdInvitations.id,
      householdId: householdInvitations.householdId,
      email: householdInvitations.email,
      name: householdInvitations.name,
      role: householdInvitations.role,
      status: householdInvitations.status,
      invitedByUserId: householdInvitations.invitedByUserId,
      acceptedByUserId: householdInvitations.acceptedByUserId,
      expiresAt: householdInvitations.expiresAt,
      acceptedAt: householdInvitations.acceptedAt,
      cancelledAt: householdInvitations.cancelledAt,
      createdAt: householdInvitations.createdAt,
      updatedAt: householdInvitations.updatedAt,
      providerId: providers.id,
      providerKey: providers.providerKey,
      providerDisplayName: providers.displayName,
    })
    .from(householdInvitations)
    .leftJoin(
      householdInvitationProviderAccess,
      eq(
        householdInvitationProviderAccess.invitationId,
        householdInvitations.id,
      ),
    )
    .leftJoin(
      providers,
      eq(providers.id, householdInvitationProviderAccess.providerId),
    )
    .where(
      householdId
        ? eq(householdInvitations.householdId, householdId)
        : undefined,
    )
    .orderBy(sql`${householdInvitations.createdAt} DESC`);

  return groupInvitationRows(rows);
}

export async function getInvitationByTokenHash(
  db: D1Database,
  tokenHash: string,
) {
  const rows = await dbForDatabase(db)
    .select({
      id: householdInvitations.id,
      householdId: householdInvitations.householdId,
      email: householdInvitations.email,
      name: householdInvitations.name,
      role: householdInvitations.role,
      status: householdInvitations.status,
      invitedByUserId: householdInvitations.invitedByUserId,
      acceptedByUserId: householdInvitations.acceptedByUserId,
      expiresAt: householdInvitations.expiresAt,
      acceptedAt: householdInvitations.acceptedAt,
      cancelledAt: householdInvitations.cancelledAt,
      createdAt: householdInvitations.createdAt,
      updatedAt: householdInvitations.updatedAt,
      providerId: providers.id,
      providerKey: providers.providerKey,
      providerDisplayName: providers.displayName,
    })
    .from(householdInvitations)
    .leftJoin(
      householdInvitationProviderAccess,
      eq(
        householdInvitationProviderAccess.invitationId,
        householdInvitations.id,
      ),
    )
    .leftJoin(
      providers,
      eq(providers.id, householdInvitationProviderAccess.providerId),
    )
    .where(eq(householdInvitations.tokenHash, tokenHash));

  return groupInvitationRows(rows)[0] ?? null;
}

export async function getInvitationById(db: D1Database, invitationId: string) {
  const rows = await dbForDatabase(db)
    .select({
      id: householdInvitations.id,
      householdId: householdInvitations.householdId,
      email: householdInvitations.email,
      name: householdInvitations.name,
      role: householdInvitations.role,
      status: householdInvitations.status,
      invitedByUserId: householdInvitations.invitedByUserId,
      acceptedByUserId: householdInvitations.acceptedByUserId,
      expiresAt: householdInvitations.expiresAt,
      acceptedAt: householdInvitations.acceptedAt,
      cancelledAt: householdInvitations.cancelledAt,
      createdAt: householdInvitations.createdAt,
      updatedAt: householdInvitations.updatedAt,
      providerId: providers.id,
      providerKey: providers.providerKey,
      providerDisplayName: providers.displayName,
    })
    .from(householdInvitations)
    .leftJoin(
      householdInvitationProviderAccess,
      eq(
        householdInvitationProviderAccess.invitationId,
        householdInvitations.id,
      ),
    )
    .leftJoin(
      providers,
      eq(providers.id, householdInvitationProviderAccess.providerId),
    )
    .where(eq(householdInvitations.id, invitationId));

  return groupInvitationRows(rows)[0] ?? null;
}

export async function cancelInvitation(db: D1Database, invitationId: string) {
  await dbForDatabase(db)
    .update(householdInvitations)
    .set({
      status: "cancelled",
      cancelledAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(householdInvitations.id, invitationId));
}

export async function acceptInvitation(
  db: D1Database,
  input: {
    invitationId: string;
    householdId: string;
    acceptedByUserId: string;
    role: InvitationRole;
  },
) {
  const database = dbForDatabase(db);

  // D1 does not support SQL transactions (BEGIN/COMMIT); `batch` is atomic.
  await database.batch([
    database
      .insert(householdMemberships)
      .values({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        userId: input.acceptedByUserId,
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
      }),
    database
      .update(householdInvitations)
      .set({
        status: "accepted",
        acceptedByUserId: input.acceptedByUserId,
        acceptedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(householdInvitations.id, input.invitationId)),
  ]);

  // Carry the invitation's provider scope over to the new membership.
  // Idempotent (INSERT OR IGNORE), so a retry after a failure here is safe.
  await database.run(sql`
    INSERT OR IGNORE INTO household_member_provider_access (id, household_membership_id, provider_id)
    SELECT lower(hex(randomblob(16))), household_memberships.id, household_invitation_provider_access.provider_id
    FROM household_invitation_provider_access
    INNER JOIN household_memberships
      ON household_memberships.household_id = ${input.householdId}
     AND household_memberships.user_id = ${input.acceptedByUserId}
    WHERE household_invitation_provider_access.invitation_id = ${input.invitationId}
  `);
}

/** True when the invitation's expiry (ISO-8601 UTC) is in the past. */
export function isInvitationExpired(
  invitation: Pick<InvitationRecord, "expiresAt">,
  now: Date = new Date(),
): boolean {
  const expiresAt = new Date(invitation.expiresAt).getTime();
  return Number.isNaN(expiresAt) || expiresAt <= now.getTime();
}

/**
 * Marks pending invitations whose expiry has passed as expired.
 *
 * `expires_at` is written by the app as ISO-8601 UTC ("…T10:00:00.000Z").
 * SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS"; comparing the two
 * lexically is wrong ('T' sorts after ' '), so the comparison value must be
 * an ISO string produced in JS.
 */
export async function refreshExpiredInvitations(
  db: D1Database,
  now: Date = new Date(),
) {
  await dbForDatabase(db)
    .update(householdInvitations)
    .set({
      status: "expired",
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(householdInvitations.status, "pending"),
        sql`${householdInvitations.expiresAt} <= ${now.toISOString()}`,
      ),
    );
}

function groupInvitationRows(rows: InvitationWithProviderRow[]) {
  const grouped = new Map<
    string,
    InvitationRecord & {
      householdId: string;
      providers: Array<{
        id: string;
        provider_key: string;
        display_name: string;
      }>;
    }
  >();

  for (const row of rows) {
    const existing = grouped.get(row.id);

    if (existing) {
      if (row.providerId && row.providerKey && row.providerDisplayName) {
        existing.providers.push({
          id: row.providerId,
          provider_key: row.providerKey,
          display_name: row.providerDisplayName,
        });
      }
      continue;
    }

    grouped.set(row.id, {
      id: row.id,
      householdId: row.householdId,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      invitedByUserId: row.invitedByUserId,
      acceptedByUserId: row.acceptedByUserId,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      providers:
        row.providerId && row.providerKey && row.providerDisplayName
          ? [
              {
                id: row.providerId,
                provider_key: row.providerKey,
                display_name: row.providerDisplayName,
              },
            ]
          : [],
    });
  }

  return Array.from(grouped.values());
}

export async function getProvidersForInvitation(
  db: D1Database,
  invitationId: string,
) {
  const rows = await dbForDatabase(db)
    .select({
      id: providers.id,
      provider_key: providers.providerKey,
      display_name: providers.displayName,
    })
    .from(providers)
    .innerJoin(
      householdInvitationProviderAccess,
      eq(householdInvitationProviderAccess.providerId, providers.id),
    )
    .where(eq(householdInvitationProviderAccess.invitationId, invitationId));

  return rows;
}

export async function replaceInvitationProviders(
  db: D1Database,
  invitationId: string,
  providerIds: string[],
) {
  const database = dbForDatabase(db);

  // D1 does not support SQL transactions (BEGIN/COMMIT); `batch` is atomic.
  await database.batch([
    database
      .delete(householdInvitationProviderAccess)
      .where(eq(householdInvitationProviderAccess.invitationId, invitationId)),
    ...invitationProviderInserts(database, invitationId, providerIds),
  ]);
}

/**
 * One insert statement per provider so each statement stays well under D1's
 * bound-parameter limit regardless of how many providers are scoped.
 */
function invitationProviderInserts(
  database: AppDatabase,
  invitationId: string,
  providerIds: string[],
) {
  return providerIds.map((providerId) =>
    database.insert(householdInvitationProviderAccess).values({
      id: crypto.randomUUID(),
      invitationId,
      providerId,
      createdAt: sql`CURRENT_TIMESTAMP`,
    }),
  );
}

export async function getProvidersByIds(db: D1Database, providerIds: string[]) {
  if (providerIds.length === 0) {
    return [];
  }

  return dbForDatabase(db)
    .select({
      id: providers.id,
      provider_key: providers.providerKey,
      display_name: providers.displayName,
    })
    .from(providers)
    .where(inArray(providers.id, providerIds));
}
