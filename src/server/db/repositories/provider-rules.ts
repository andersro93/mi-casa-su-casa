import { sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import type { ProviderRow } from "../types";

export type SenderRuleMatch = {
  providerId: string;
  providerKey: string;
};

export async function findProviderMatch(
  db: D1Database,
  fromAddress: string,
): Promise<SenderRuleMatch | null> {
  const database = dbForDatabase(db);
  const exact = await database.get<SenderRuleMatch>(sql`
    SELECT providers.id AS providerId, providers.provider_key AS providerKey
    FROM sender_rules
    INNER JOIN providers ON providers.id = sender_rules.provider_id
    WHERE sender_rules.match_type = 'exact' AND lower(sender_rules.match_value) = lower(${fromAddress})
    LIMIT 1
  `);

  if (exact) {
    return exact;
  }

  const domain = fromAddress.split("@")[1]?.toLowerCase();
  if (!domain) {
    return null;
  }

  return database.get<SenderRuleMatch>(sql`
    SELECT providers.id AS providerId, providers.provider_key AS providerKey
    FROM sender_rules
    INNER JOIN providers ON providers.id = sender_rules.provider_id
    WHERE sender_rules.match_type = 'domain' AND lower(sender_rules.match_value) = lower(${domain})
    LIMIT 1
  `);
}

export async function userHasProviderAccess(
  db: D1Database,
  userId: string,
  providerKey: string,
): Promise<boolean> {
  const row = await dbForDatabase(db).get<{ allowed: number }>(sql`
    SELECT 1 AS allowed
    FROM user_provider_access
    INNER JOIN providers ON providers.id = user_provider_access.provider_id
    WHERE user_provider_access.user_id = ${userId} AND providers.provider_key = ${providerKey}
    LIMIT 1
  `);

  return Boolean(row?.allowed);
}

export async function getProviderByKey(
  db: D1Database,
  providerKey: string,
): Promise<ProviderRow | null> {
  return dbForDatabase(db).get<ProviderRow>(sql`
    SELECT id, provider_key, display_name
    FROM providers
    WHERE provider_key = ${providerKey}
    LIMIT 1
  `);
}
