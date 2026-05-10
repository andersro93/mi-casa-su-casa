import {
  insertMessage,
  insertQuarantineMessage,
} from "../db/repositories/messages";
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

  await insertMessage(
    appContext.env.DB,
    parsed,
    classification.providerId,
    classification,
  );
}
