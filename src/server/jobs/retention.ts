import { purgeExpired } from "../db/repositories/messages";
import type { AppContext } from "../runtime/context";

export async function purgeExpiredMessages(
  appContext: AppContext,
  scheduledTime = Date.now(),
) {
  const nowIso = new Date(scheduledTime).toISOString();
  await purgeExpired(appContext.env.DB, nowIso);
}
