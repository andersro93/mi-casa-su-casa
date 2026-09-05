import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { request as apiRequest } from "@playwright/test";
import { BASE_URL, completeSetup, OWNER_STATE } from "./helpers";

/**
 * Runs once per `playwright test`, before any spec.
 *
 * First-run setup can happen exactly once per database, which makes it a poor
 * fit for a test that has to run first: spec file order is not something to
 * rely on, and with two projects the same file runs twice. So setup happens
 * here, through the API, and setup.spec.ts asserts what a CONFIGURED
 * installation does — `/setup` locked, and the same 409 for a wrong secret as
 * for the right one.
 *
 * The owner ends up signed in, and their storage state is saved for every
 * owner-only spec to adopt with `test.use({ storageState: OWNER_STATE })`.
 * That keeps the suite's sign-in count down to the specs whose subject IS
 * signing in — the auth routes are rate limited per client address, and the
 * whole suite shares one.
 */
export default async function globalSetup(): Promise<void> {
  const context = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    await completeSetup(context);
    await mkdir(dirname(OWNER_STATE), { recursive: true });
    await context.storageState({ path: OWNER_STATE });
  } finally {
    await context.dispose();
  }
}
