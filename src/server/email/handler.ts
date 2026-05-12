import { getHouseholdBySlug } from "../db/repositories/households";
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

  if (!parsed.householdSlug) {
    return;
  }

  if (classification.kind === "quarantine") {
    const household = await getHouseholdBySlug(
      appContext.env.DB,
      parsed.householdSlug,
    );
    const householdId = household?.id ?? null;

    if (!householdId) {
      return;
    }

    await insertQuarantineMessage(
      appContext.env.DB,
      parsed,
      householdId,
      classification,
    );
    return;
  }

  await insertMessage(
    appContext.env.DB,
    parsed,
    classification.householdId,
    classification.providerId,
    classification,
  );
}
