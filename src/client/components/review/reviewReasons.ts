import type { ProviderSummary, QuarantineMessage } from "../../types";

export type ReviewReason = {
  /** Short chip text. */
  label: string;
  /** One-sentence explanation for the expanded card. */
  explanation: string;
  tone: "warning" | "error" | "info";
};

/** Turn the classifier's technical reason into something a family owner can act on. */
export function describeReviewReason(reason: string): ReviewReason {
  const text = reason.toLowerCase();
  if (
    text.includes("authentication failed") ||
    text.includes("authentication_failed") ||
    text.includes("auth_failed") ||
    text.includes("dmarc") ||
    text.includes("spf") ||
    text.includes("dkim")
  ) {
    return {
      label: "Sender check failed",
      explanation:
        "The email claims to be from a service you know, but it didn't pass the checks that prove it really came from there. Be careful — this is what phishing looks like. Only file it if you're sure.",
      tone: "error",
    };
  }
  if (
    text.includes("no sender rule") ||
    text.includes("no matching") ||
    text.includes("no_matching") ||
    text.includes("unknown sender")
  ) {
    return {
      label: "Unknown sender",
      explanation:
        "No service lists this sender yet. If it belongs to one of your services, file it there — and we can remember the sender for next time.",
      tone: "warning",
    };
  }
  return {
    label: "Needs a look",
    explanation: reason,
    tone: "info",
  };
}

/** The domain part of the envelope sender, e.g. "em.netflix.com". */
export function senderDomain(
  message: Pick<QuarantineMessage, "envelope_from">,
) {
  const at = message.envelope_from.lastIndexOf("@");
  return at >= 0 ? message.envelope_from.slice(at + 1).toLowerCase() : "";
}

/** Guess which service an unknown sender belongs to from its domain. */
export function suggestService(
  message: Pick<QuarantineMessage, "envelope_from" | "from_header">,
  providers: ProviderSummary[],
): ProviderSummary | null {
  const haystack = `${senderDomain(message)} ${(message.from_header ?? "").toLowerCase()}`;
  return (
    providers.find((provider) => {
      const key = provider.provider_key.toLowerCase();
      const name = provider.display_name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      return (
        (key.length >= 3 && haystack.includes(key)) ||
        (name.length >= 3 && haystack.includes(name))
      );
    }) ?? null
  );
}
