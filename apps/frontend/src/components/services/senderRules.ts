import type { SenderRule } from "../../types";

const HOSTNAME =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise what the user typed for a sender (trim, lowercase, strip a leading @ for domains). */
export function normalizeSenderValue(
  matchType: SenderRule["match_type"],
  value: string,
) {
  const trimmed = value.trim().toLowerCase();
  return matchType === "domain" ? trimmed.replace(/^@+/, "") : trimmed;
}

/** Plain-language validation for a sender value; null when fine. */
export function describeSenderProblem(
  matchType: SenderRule["match_type"],
  value: string,
): string | null {
  const normalized = normalizeSenderValue(matchType, value);
  if (!normalized) {
    return matchType === "domain"
      ? "Enter a domain, like netflix.com."
      : "Enter an email address, like info@account.netflix.com.";
  }
  if (matchType === "domain") {
    if (normalized.includes("@")) {
      return "That looks like a full address. Either switch to “only this exact address” or enter just the part after the @.";
    }
    return HOSTNAME.test(normalized)
      ? null
      : "That doesn't look like a domain. Try something like netflix.com.";
  }
  return EMAIL.test(normalized)
    ? null
    : "That doesn't look like an email address. Try something like info@account.netflix.com.";
}

/** Human label for a sender rule, e.g. "netflix.com · any address" */
export function describeSender(
  rule: Pick<SenderRule, "match_type" | "match_value">,
) {
  return rule.match_type === "domain"
    ? `${rule.match_value} · any address`
    : rule.match_value;
}

/** Suggest a domain sender from a service name, e.g. "Netflix" → "netflix.com". */
export function suggestDomainFromName(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return base ? `${base}.com` : "";
}
