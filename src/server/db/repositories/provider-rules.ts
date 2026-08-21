import { sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import type {
  ProviderConfigurationRow,
  ProviderRow,
  SenderRuleRow,
} from "../types";

export type SenderRuleMatch = {
  householdId: string;
  householdSlug: string;
  providerId: string;
  providerKey: string;
};

export type SenderCandidate = {
  address: string;
  /** Where the address came from; reported back so policy can be applied. */
  source: "header" | "envelope";
};

export type SenderRuleMatchWithSource = SenderRuleMatch & {
  matchedAddress: string;
  matchedSource: SenderCandidate["source"];
  matchType: "exact" | "domain";
};

function senderMatchColumns() {
  return sql`
    SELECT providers.id AS providerId,
           providers.provider_key AS providerKey,
           providers.household_id AS householdId,
           households.slug AS householdSlug
    FROM sender_rules
    INNER JOIN providers ON providers.id = sender_rules.provider_id
    INNER JOIN households ON households.id = providers.household_id`;
}

/**
 * Finds the provider whose sender rule matches one of the candidate sender
 * addresses. Exact-address rules win over domain rules; within each type the
 * candidates are tried in the given order. Domain rules match the domain
 * itself and any subdomain (`netflix.com` matches `em.netflix.com`).
 */
export async function findProviderMatch(
  db: D1Database,
  householdId: string,
  candidates: SenderCandidate[] | string,
): Promise<SenderRuleMatchWithSource | null> {
  const database = dbForDatabase(db);
  const list: SenderCandidate[] =
    typeof candidates === "string"
      ? [{ address: candidates, source: "envelope" }]
      : candidates;
  const seen = new Set<string>();
  const normalized = list
    .map((candidate) => ({
      ...candidate,
      address: candidate.address.trim().toLowerCase(),
    }))
    .filter((candidate) => {
      if (!candidate.address || seen.has(candidate.address)) return false;
      seen.add(candidate.address);
      return true;
    });

  for (const candidate of normalized) {
    const exact = await database.get<SenderRuleMatch>(sql`
      ${senderMatchColumns()}
      WHERE sender_rules.household_id = ${householdId}
        AND sender_rules.match_type = 'exact'
        AND lower(sender_rules.match_value) = ${candidate.address}
      LIMIT 1
    `);
    if (exact) {
      return {
        ...exact,
        matchedAddress: candidate.address,
        matchedSource: candidate.source,
        matchType: "exact",
      };
    }
  }

  for (const candidate of normalized) {
    const domain = candidate.address.split("@")[1];
    if (!domain) continue;

    const byDomain = await database.get<SenderRuleMatch>(sql`
      ${senderMatchColumns()}
      WHERE sender_rules.household_id = ${householdId}
        AND sender_rules.match_type = 'domain'
        AND (
          lower(sender_rules.match_value) = ${domain}
          OR ${domain} LIKE '%.' || lower(sender_rules.match_value)
        )
      ORDER BY length(sender_rules.match_value) DESC
      LIMIT 1
    `);
    if (byDomain) {
      return {
        ...byDomain,
        matchedAddress: candidate.address,
        matchedSource: candidate.source,
        matchType: "domain",
      };
    }
  }

  return null;
}

export async function userHasProviderAccess(
  db: D1Database,
  householdId: string,
  userId: string,
  providerKey: string,
): Promise<boolean> {
  const row = await dbForDatabase(db).get<{ allowed: number }>(sql`
    SELECT 1 AS allowed
    FROM household_memberships
    INNER JOIN household_member_provider_access
      ON household_member_provider_access.household_membership_id = household_memberships.id
    INNER JOIN providers ON providers.id = household_member_provider_access.provider_id
    WHERE household_memberships.household_id = ${householdId}
      AND household_memberships.user_id = ${userId}
      AND providers.provider_key = ${providerKey}
    LIMIT 1
  `);

  return Boolean(row?.allowed);
}

export async function getProviderByKey(
  db: D1Database,
  householdId: string,
  providerKey: string,
): Promise<ProviderRow | null> {
  const row = await dbForDatabase(db).get<ProviderRow>(sql`
    SELECT id, household_id, provider_key, display_name, created_at
    FROM providers
    WHERE household_id = ${householdId} AND provider_key = ${providerKey}
    LIMIT 1
  `);

  return row ?? null;
}

export async function listProviderConfigurations(
  db: D1Database,
  householdId: string,
): Promise<ProviderConfigurationRow[]> {
  return dbForDatabase(db).all<ProviderConfigurationRow>(sql`
    SELECT providers.id,
           providers.household_id,
           providers.provider_key,
           providers.display_name,
           providers.created_at,
           COUNT(sender_rules.id) AS rule_count
    FROM providers
    LEFT JOIN sender_rules ON sender_rules.provider_id = providers.id
    WHERE providers.household_id = ${householdId}
    GROUP BY providers.id, providers.provider_key, providers.display_name, providers.created_at
    ORDER BY providers.display_name ASC
  `);
}

export async function listSenderRules(
  db: D1Database,
  householdId: string,
): Promise<SenderRuleRow[]> {
  return dbForDatabase(db).all<SenderRuleRow>(sql`
    SELECT id, household_id, provider_id, match_type, match_value, created_at
    FROM sender_rules
    WHERE household_id = ${householdId}
    ORDER BY created_at ASC, match_value ASC
  `);
}

export async function createProvider(
  db: D1Database,
  householdId: string,
  providerKey: string,
  displayName: string,
): Promise<ProviderRow> {
  const id = crypto.randomUUID();

  await dbForDatabase(db).run(sql`
    INSERT INTO providers (id, household_id, provider_key, display_name)
    VALUES (${id}, ${householdId}, ${providerKey}, ${displayName})
  `);

  const provider = await getProviderByKey(db, householdId, providerKey);

  if (!provider) {
    throw new Error("Provider creation failed");
  }

  return provider;
}

export async function updateProvider(
  db: D1Database,
  householdId: string,
  providerId: string,
  providerKey: string,
  displayName: string,
) {
  await dbForDatabase(db).run(sql`
    UPDATE providers
    SET provider_key = ${providerKey},
        display_name = ${displayName}
    WHERE id = ${providerId} AND household_id = ${householdId}
  `);
}

export async function deleteProvider(
  db: D1Database,
  householdId: string,
  providerId: string,
) {
  await dbForDatabase(db).run(sql`
    DELETE FROM providers
    WHERE id = ${providerId} AND household_id = ${householdId}
  `);
}

export async function getProviderById(
  db: D1Database,
  householdId: string,
  providerId: string,
): Promise<ProviderRow | null> {
  const row = await dbForDatabase(db).get<ProviderRow>(sql`
    SELECT id, household_id, provider_key, display_name, created_at
    FROM providers
    WHERE id = ${providerId} AND household_id = ${householdId}
    LIMIT 1
  `);

  return row ?? null;
}

export async function createSenderRule(
  db: D1Database,
  householdId: string,
  providerId: string,
  matchType: SenderRuleRow["match_type"],
  matchValue: string,
): Promise<SenderRuleRow> {
  const id = crypto.randomUUID();

  await dbForDatabase(db).run(sql`
    INSERT INTO sender_rules (id, household_id, provider_id, match_type, match_value)
    VALUES (${id}, ${householdId}, ${providerId}, ${matchType}, ${matchValue})
  `);

  const rule = await getSenderRuleById(db, householdId, id);

  if (!rule) {
    throw new Error("Sender rule creation failed");
  }

  return rule;
}

export async function updateSenderRule(
  db: D1Database,
  householdId: string,
  ruleId: string,
  providerId: string,
  matchType: SenderRuleRow["match_type"],
  matchValue: string,
) {
  await dbForDatabase(db).run(sql`
    UPDATE sender_rules
    SET household_id = ${householdId},
        provider_id = ${providerId},
        match_type = ${matchType},
        match_value = ${matchValue}
    WHERE id = ${ruleId} AND household_id = ${householdId}
  `);
}

export async function deleteSenderRule(
  db: D1Database,
  householdId: string,
  ruleId: string,
) {
  await dbForDatabase(db).run(sql`
    DELETE FROM sender_rules
    WHERE id = ${ruleId} AND household_id = ${householdId}
  `);
}

export async function getSenderRuleById(
  db: D1Database,
  householdId: string,
  ruleId: string,
): Promise<SenderRuleRow | null> {
  const row = await dbForDatabase(db).get<SenderRuleRow>(sql`
    SELECT id, household_id, provider_id, match_type, match_value, created_at
    FROM sender_rules
    WHERE id = ${ruleId} AND household_id = ${householdId}
    LIMIT 1
  `);

  return row ?? null;
}
