import {
  countUnreviewedQuarantine,
  insertMessage,
  insertQuarantineMessage,
} from "../db/repositories/messages";
import { classifyEmail } from "../domain/classify-email";
import type { AppContext } from "../runtime/context";
import { logEvent } from "../runtime/log";
import { parseIncomingEmail } from "./parse";

/** Email Routing accepts up to 25 MB; OTP mail is tiny. Reject the rest early. */
export const MAX_RAW_MESSAGE_BYTES = 2 * 1024 * 1024;
/** Unreviewed quarantine rows per household before new unmatched mail is refused. */
export const MAX_UNREVIEWED_QUARANTINE = 200;

function log(event: string, fields: Record<string, unknown>) {
  logEvent("info", event, fields);
}

function logError(event: string, fields: Record<string, unknown>) {
  logEvent("error", event, fields);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Inbound Email Worker entrypoint. Known-bad input (unknown recipient, too
 * large, quarantine full) is rejected permanently with a reason; unexpected
 * failures are logged with context and re-thrown so Cloudflare answers with a
 * temporary error and the sender retries.
 */
export async function handleIncomingEmail(
  message: ForwardableEmailMessage,
  appContext: AppContext,
) {
  const base = {
    from: message.from,
    to: message.to,
    rawSize: message.rawSize,
  };

  if (message.rawSize > MAX_RAW_MESSAGE_BYTES) {
    log("email_rejected", { ...base, reason: "too_large" });
    message.setReject("Message too large");
    return;
  }

  let parsed: Awaited<ReturnType<typeof parseIncomingEmail>>;
  try {
    parsed = await parseIncomingEmail(message);
  } catch (error) {
    logError("email_parse_failed", { ...base, error: errorMessage(error) });
    message.setReject("Message could not be parsed");
    return;
  }

  const context = { ...base, messageId: parsed.messageId };

  try {
    const classification = await classifyEmail(appContext.env.DB, parsed);

    if (classification.kind === "quarantine") {
      if (!classification.householdId) {
        log("email_rejected", {
          ...context,
          reason: "unknown_recipient",
          detail: classification.reason,
        });
        message.setReject("Unknown recipient");
        return;
      }

      const pending = await countUnreviewedQuarantine(
        appContext.env.DB,
        classification.householdId,
      );

      if (pending >= MAX_UNREVIEWED_QUARANTINE) {
        log("email_rejected", {
          ...context,
          householdId: classification.householdId,
          reason: "quarantine_full",
          pending,
        });
        message.setReject("Mailbox quarantine is full");
        return;
      }

      await insertQuarantineMessage(
        appContext.env.DB,
        parsed,
        classification.householdId,
        classification,
      );
      log("email_quarantined", {
        ...context,
        householdId: classification.householdId,
        reason: classification.reason,
        truncated: parsed.textBodyTruncated === true,
      });
      return;
    }

    await insertMessage(
      appContext.env.DB,
      parsed,
      classification.householdId,
      classification.providerId,
      classification,
    );
    log("email_stored", {
      ...context,
      householdId: classification.householdId,
      providerKey: classification.providerKey,
      codeFound: classification.code !== null,
      truncated: parsed.textBodyTruncated === true,
    });
  } catch (error) {
    logError("email_ingest_failed", { ...context, error: errorMessage(error) });
    throw error;
  }
}
