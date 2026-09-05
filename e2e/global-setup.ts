import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type APIRequestContext,
  request as apiRequest,
  type Browser,
  chromium,
  expect,
} from "@playwright/test";
import {
  apiSignIn,
  BASE_URL,
  clientAddressHeaders,
  EMAIL_DOMAIN,
  OWNER_EMAIL,
  OWNER_HOUSEHOLD,
  OWNER_NAME,
  OWNER_SLUG,
  OWNER_STATE,
  PASSWORD,
  SETUP_SECRET,
  setupStatus,
} from "./helpers";

/**
 * Runs once per `playwright test`, before any spec — and it is where the
 * first-run setup SCREEN is tested.
 *
 * Setup can happen exactly once per database, which makes it a poor fit for an
 * ordinary spec: file order is not something to rely on, and with two projects
 * the same file would run twice. But it is also the first screen anybody ever
 * sees, and the only one that creates an account without an invitation, so it
 * cannot go untested either. So the whole first-run journey is driven here, in
 * a real browser against the real image — `/` redirecting to `/setup`, a wrong
 * SETUP_SECRET rejected with the installation left untouched, then the real
 * secret landing the owner in their inbox — and `setup.spec.ts` picks up
 * afterwards with what a CONFIGURED installation must do.
 *
 * The session that comes out of it is saved to OWNER_STATE for every
 * owner-only spec to adopt with `test.use({ storageState: OWNER_STATE })`,
 * which keeps the suite's sign-in count down to the specs whose subject IS
 * signing in.
 */
export default async function globalSetup(): Promise<void> {
  const api = await apiRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: clientAddressHeaders(),
  });
  const browser = await chromium.launch();

  try {
    const status = await setupStatus(api);
    if (status.needsSetup) {
      await runFirstRunSetup(browser, api);
      return;
    }

    // Already configured — a re-run against a stack left up from an earlier
    // `bunx playwright test`. There is no first run left to drive, so the
    // owner simply signs in. `mise run e2e` always starts a fresh stack, so
    // this branch is for the iterating-locally case.
    await apiSignIn(api, OWNER_EMAIL, PASSWORD);
    await mkdir(dirname(OWNER_STATE), { recursive: true });
    await api.storageState({ path: OWNER_STATE });
  } finally {
    await browser.close();
    await api.dispose();
  }
}

/** The first-run journey, through the screen a real operator uses. */
async function runFirstRunSetup(browser: Browser, api: APIRequestContext) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: clientAddressHeaders(),
  });
  const page = await context.newPage();

  try {
    // An unconfigured installation sends every visitor to setup, whatever
    // they asked for.
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Set up your household inbox" }),
    ).toBeVisible();

    await page
      .getByRole("textbox", { name: "Household name" })
      .fill(OWNER_HOUSEHOLD);
    // The address is derived from the household name as you type; setting it
    // by hand is what an operator who wants a particular mailbox does, and the
    // preview underneath is the promise being made about where mail arrives.
    await page.getByRole("textbox", { name: "Inbox address" }).fill(OWNER_SLUG);
    await expect(
      page.getByText(
        `Login codes will arrive at ${OWNER_SLUG}@${EMAIL_DOMAIN}.`,
      ),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Owner email" }).fill(OWNER_EMAIL);
    await page.getByRole("textbox", { name: "Your name" }).fill(OWNER_NAME);
    await page
      .getByRole("textbox", { name: "Choose a password" })
      .fill(PASSWORD);

    // --- the wrong secret first: this is the guard the whole screen exists
    // for, and it has to leave the installation exactly as it found it.
    await page
      .getByRole("textbox", { name: "Setup secret" })
      .fill("not-the-setup-secret");
    await page.getByRole("button", { name: "Complete setup" }).click();

    await expect(page.getByRole("alert")).toHaveText("Invalid setup secret");
    await expect(page).toHaveURL(/\/setup/);
    const afterRejection = await setupStatus(api);
    expect(
      afterRejection.needsSetup,
      "a rejected secret must not claim the installation",
    ).toBe(true);

    // --- and now the real one
    await page
      .getByRole("textbox", { name: "Setup secret" })
      .fill(SETUP_SECRET);
    await page.getByRole("button", { name: "Complete setup" }).click();

    // The owner is signed in as part of the same response, so they land on
    // their household's inbox rather than on a sign-in form asking for the
    // password they have just chosen.
    await expect(page).toHaveURL(new RegExp(`/${OWNER_SLUG}/inbox`), {
      timeout: 20_000,
    });
    await expect(
      page.getByRole("heading", { name: "Latest codes" }),
    ).toBeVisible();

    await mkdir(dirname(OWNER_STATE), { recursive: true });
    await context.storageState({ path: OWNER_STATE });
  } finally {
    await context.close();
  }
}
