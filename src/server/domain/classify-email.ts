import { getHouseholdBySlug } from "../db/repositories/households";
import {
  findProviderMatch,
  type SenderCandidate,
} from "../db/repositories/provider-rules";
import type {
  ClassificationResult,
  ParsedIncomingEmail,
  SenderAuthentication,
} from "../db/types";
import { extractVerificationCode } from "./extract-code";

function senderCandidates(parsed: ParsedIncomingEmail): SenderCandidate[] {
  const candidates: SenderCandidate[] = [];
  if (parsed.fromAddress) {
    candidates.push({ address: parsed.fromAddress, source: "header" });
  }
  candidates.push({ address: parsed.envelopeFrom, source: "envelope" });
  return candidates;
}

/**
 * Decides whether a rule match may be trusted given the upstream
 * authentication results. Without an Authentication-Results header (local
 * development, tests) everything is allowed.
 *
 * - dmarc=fail: never trusted (the From: domain failed its own policy).
 * - A match on the From: header address needs DKIM or DMARC to pass; the
 *   header is otherwise trivially forgeable.
 * - A match on the envelope (MAIL FROM) address needs SPF to pass.
 */
export function authenticationVerdict(
  auth: SenderAuthentication | null | undefined,
  source: SenderCandidate["source"],
): { trusted: true } | { trusted: false; reason: string } {
  if (!auth) {
    return { trusted: true };
  }

  if (auth.dmarc === "fail") {
    return { trusted: false, reason: "dmarc=fail" };
  }

  if (source === "header") {
    if (auth.dkim === "pass" || auth.dmarc === "pass") {
      return { trusted: true };
    }
    return {
      trusted: false,
      reason: `From header not authenticated (dkim=${auth.dkim ?? "none"}, dmarc=${auth.dmarc ?? "none"})`,
    };
  }

  if (auth.spf === "pass") {
    return { trusted: true };
  }
  return {
    trusted: false,
    reason: `envelope sender not authenticated (spf=${auth.spf ?? "none"})`,
  };
}

export async function classifyEmail(
  db: D1Database,
  parsed: ParsedIncomingEmail,
): Promise<ClassificationResult> {
  const code = extractVerificationCode(parsed.textBody);

  if (!parsed.householdSlug) {
    return {
      kind: "quarantine",
      householdId: null,
      reason: "No household slug could be resolved from the recipient address.",
      code,
    };
  }

  const household = await getHouseholdBySlug(db, parsed.householdSlug);

  if (!household) {
    return {
      kind: "quarantine",
      householdId: null,
      reason: "No household matched the inbound recipient address.",
      code,
    };
  }

  const providerMatch = await findProviderMatch(
    db,
    household.id,
    senderCandidates(parsed),
  );

  if (!providerMatch) {
    return {
      kind: "quarantine",
      householdId: household.id,
      reason:
        "No sender rule matched the inbound email within the addressed household.",
      code,
    };
  }

  const verdict = authenticationVerdict(
    parsed.authentication,
    providerMatch.matchedSource,
  );

  if (!verdict.trusted) {
    return {
      kind: "quarantine",
      householdId: household.id,
      reason: `Sender ${providerMatch.matchedAddress} matched provider ${providerMatch.providerKey} but sender authentication failed: ${verdict.reason}.`,
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
