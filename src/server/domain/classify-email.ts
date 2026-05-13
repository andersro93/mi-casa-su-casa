import { getHouseholdBySlug } from "../db/repositories/households";
import { findProviderMatch } from "../db/repositories/provider-rules";
import type { ClassificationResult, ParsedIncomingEmail } from "../db/types";
import { extractVerificationCode } from "./extract-code";

export async function classifyEmail(
  db: D1Database,
  parsed: ParsedIncomingEmail,
): Promise<ClassificationResult> {
  const code = extractVerificationCode(parsed.textBody);

  if (!parsed.householdSlug) {
    return {
      kind: "quarantine",
      reason: "No household slug could be resolved from the recipient address.",
      code,
    };
  }

  const household = await getHouseholdBySlug(db, parsed.householdSlug);

  if (!household) {
    return {
      kind: "quarantine",
      reason: "No household matched the inbound recipient address.",
      code,
    };
  }

  const providerMatch = await findProviderMatch(
    db,
    household.id,
    parsed.envelopeFrom,
  );

  if (!providerMatch) {
    return {
      kind: "quarantine",
      reason:
        "No sender rule matched the inbound email within the addressed household.",
      code,
    };
  }

  return {
    kind: "matched",
    householdId: providerMatch.householdId,
    householdSlug: providerMatch.householdSlug,
    providerId: providerMatch.providerId,
    providerKey: providerMatch.providerKey,
    code,
    reason: code
      ? "Sender matched a configured rule and a likely verification code was found."
      : "Sender matched a configured rule.",
  };
}
