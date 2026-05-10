import {
  insertMessage,
  insertQuarantineMessage,
} from "../db/repositories/messages";
import { findProviderMatch } from "../db/repositories/provider-rules";
import { classifyEmail } from "../domain/classify-email";
import type { AppContext } from "../runtime/context";
import { parseIncomingEmail } from "./parse";

export async function handleIncomingEmail(
  message: ForwardableEmailMessage,
  appContext: AppContext,
) {
  const parsed = await parseIncomingEmail(message);
  const classification = await classifyEmail(appContext.env.DB, parsed);

  if (classification.kind === "quarantine") {
    await insertQuarantineMessage(appContext.env.DB, parsed, classification);
    return;
  }

  const providerMatch = await findProviderMatch(
    appContext.env.DB,
    parsed.envelopeFrom,
  );
  if (!providerMatch) {
    await insertQuarantineMessage(appContext.env.DB, parsed, {
      kind: "quarantine",
      reason:
        "Sender matched during classification but could not be resolved during persistence.",
      code: classification.code,
    });
    return;
  }

  await insertMessage(
    appContext.env.DB,
    parsed,
    providerMatch.providerId,
    classification,
  );
}
