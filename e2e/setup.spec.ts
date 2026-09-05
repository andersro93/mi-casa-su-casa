import { expect, test } from "./fixtures";
import {
  BASE_URL,
  OWNER_EMAIL,
  OWNER_HOUSEHOLD,
  OWNER_SLUG,
  PASSWORD,
  SETUP_SECRET,
  setupStatus,
} from "./helpers";

// First-run setup, from the other side.
//
// global-setup.ts has already claimed this installation (it has to: a database
// can only be set up once, and two projects run the suite over one stack), so
// what is left to prove is everything a CONFIGURED installation must do —
// which is the half that can regress silently. The success path itself is
// covered by global-setup running at all: nothing else in the suite would have
// an owner, a household or a session without it.

// Signed out on purpose: these are the answers a stranger gets.
test.use({ storageState: { cookies: [], origins: [] } });

test("setup is locked once the installation has an owner", async ({
  request,
}) => {
  const status = await setupStatus(request);

  expect(status.status).toBe("complete");
  expect(status.needsSetup).toBe(false);
  expect(status.setupLocked).toBe(true);
  // Not secret — every household address ends with it, and the setup screen
  // previews "name@domain" with it.
  expect(status.emailDomain).toBe("e2e.test");
});

test("/setup is no longer reachable and / sends a stranger to sign in", async ({
  page,
}) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: /Your family's login codes/ }),
  ).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("a completed installation answers the same to a wrong secret as to the right one", async ({
  request,
}) => {
  const attempt = (setupSecret: string) =>
    request.post(`${BASE_URL}/api/setup/complete`, {
      headers: { Origin: BASE_URL },
      data: {
        email: OWNER_EMAIL,
        name: "Someone Else",
        password: PASSWORD,
        householdName: OWNER_HOUSEHOLD,
        householdSlug: OWNER_SLUG,
        setupSecret,
      },
    });

  // "Already complete" is answered before the secret is even looked at, so a
  // finished installation cannot be used as an oracle for SETUP_SECRET. Both
  // of these must be the same 409, byte for byte.
  const wrong = await attempt("not-the-setup-secret");
  const right = await attempt(SETUP_SECRET);

  expect(wrong.status()).toBe(409);
  expect(right.status()).toBe(409);
  expect(await wrong.json()).toEqual(await right.json());
  expect(JSON.stringify(await wrong.json())).toContain(
    "Setup has already been completed",
  );
});
