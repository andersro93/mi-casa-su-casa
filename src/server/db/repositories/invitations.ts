import { and, eq, inArray, sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import {
  householdInvitationProviderAccess,
  householdInvitations,
  providers,
  userProviderAccess,
} from "../schema";

export type InvitationRole = "member" | "admin";
export type InvitationStatus = "pending" | "accepted" | "cancelled" | "expired";

export type InvitationRecord = {
  id: string;
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

  await dbForDatabase(db).transaction(async (tx) => {
    await tx.insert(householdInvitations).values({
      id: invitationId,
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
    });

    if (input.providerIds.length > 0) {
      await tx.insert(householdInvitationProviderAccess).values(
        input.providerIds.map((providerId) => ({
          id: crypto.randomUUID(),
          invitationId,
          providerId,
          createdAt: sql`CURRENT_TIMESTAMP`,
        })),
      );
    }
  });

  return invitationId;
}

export async function listHouseholdInvitations(db: D1Database) {
  const rows = await dbForDatabase(db)
    .select({
      id: householdInvitations.id,
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
    acceptedByUserId: string;
    providerIds: string[];
  },
) {
  await dbForDatabase(db).transaction(async (tx) => {
    if (input.providerIds.length > 0) {
      await tx.insert(userProviderAccess).values(
        input.providerIds.map((providerId) => ({
          id: crypto.randomUUID(),
          userId: input.acceptedByUserId,
          providerId,
          createdAt: sql`CURRENT_TIMESTAMP`,
        })),
      );
    }

    await tx
      .update(householdInvitations)
      .set({
        status: "accepted",
        acceptedByUserId: input.acceptedByUserId,
        acceptedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(householdInvitations.id, input.invitationId));
  });
}

export async function refreshExpiredInvitations(db: D1Database) {
  await dbForDatabase(db)
    .update(householdInvitations)
    .set({
      status: "expired",
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(householdInvitations.status, "pending"),
        sql`${householdInvitations.expiresAt} < CURRENT_TIMESTAMP`,
      ),
    );
}

function groupInvitationRows(rows: InvitationWithProviderRow[]) {
  const grouped = new Map<
    string,
    InvitationRecord & {
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
  await dbForDatabase(db).transaction(async (tx) => {
    await tx
      .delete(householdInvitationProviderAccess)
      .where(eq(householdInvitationProviderAccess.invitationId, invitationId));

    if (providerIds.length > 0) {
      await tx.insert(householdInvitationProviderAccess).values(
        providerIds.map((providerId) => ({
          id: crypto.randomUUID(),
          invitationId,
          providerId,
          createdAt: sql`CURRENT_TIMESTAMP`,
        })),
      );
    }
  });
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
