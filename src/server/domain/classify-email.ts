import { findProviderMatch } from "../db/repositories/provider-rules";
import type { ClassificationResult, ParsedIncomingEmail } from "../db/types";
import { extractVerificationCode } from "./extract-code";

export async function classifyEmail(
  db: D1Database,
  parsed: ParsedIncomingEmail,
): Promise<ClassificationResult> {
  const providerMatch = await findProviderMatch(db, parsed.envelopeFrom);
  const code = extractVerificationCode(parsed.textBody);

  if (!providerMatch) {
    return {
      kind: "quarantine",
      reason: "No sender rule matched the inbound email.",
      code,
    };
  }

  return {
    kind: "matched",
    providerKey: providerMatch.providerKey,
    code,
    reason: code
      ? "Sender matched a configured rule and a likely verification code was found."
      : "Sender matched a configured rule.",
  };
}
