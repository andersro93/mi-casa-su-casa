import type { ProviderRow } from "../types";

export type SenderRuleMatch = {
  providerId: string;
  providerKey: string;
};

export async function findProviderMatch(
  db: D1Database,
  fromAddress: string,
): Promise<SenderRuleMatch | null> {
  const exact = await db
    .prepare(
      `SELECT providers.id AS providerId, providers.provider_key AS providerKey
       FROM sender_rules
       INNER JOIN providers ON providers.id = sender_rules.provider_id
       WHERE sender_rules.match_type = 'exact' AND lower(sender_rules.match_value) = lower(?)
       LIMIT 1`,
    )
    .bind(fromAddress)
    .first<SenderRuleMatch>();

  if (exact) {
    return exact;
  }

  const domain = fromAddress.split("@")[1]?.toLowerCase();
  if (!domain) {
    return null;
  }

  return db
    .prepare(
      `SELECT providers.id AS providerId, providers.provider_key AS providerKey
       FROM sender_rules
       INNER JOIN providers ON providers.id = sender_rules.provider_id
       WHERE sender_rules.match_type = 'domain' AND lower(sender_rules.match_value) = lower(?)
       LIMIT 1`,
    )
    .bind(domain)
    .first<SenderRuleMatch>();
}

export async function userHasProviderAccess(
  db: D1Database,
  userId: string,
  providerKey: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS allowed
       FROM user_provider_access
       INNER JOIN providers ON providers.id = user_provider_access.provider_id
       WHERE user_provider_access.user_id = ? AND providers.provider_key = ?
       LIMIT 1`,
    )
    .bind(userId, providerKey)
    .first<{ allowed: number }>();

  return Boolean(row?.allowed);
}

export async function getProviderByKey(
  db: D1Database,
  providerKey: string,
): Promise<ProviderRow | null> {
  return db
    .prepare(
      `SELECT id, provider_key, display_name
       FROM providers
       WHERE provider_key = ?
       LIMIT 1`,
    )
    .bind(providerKey)
    .first<ProviderRow>();
}
