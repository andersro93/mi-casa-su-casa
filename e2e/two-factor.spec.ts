import { expect, test } from "./fixtures";
import {
  createMember,
  newBrowserContext,
  nextTotp,
  OWNER_SLUG,
  PASSWORD,
  SIGNED_OUT,
  signIn,
  submitChallengeCode,
  totpFrom,
} from "./helpers";

// Two-step verification with a real authenticator on the other side: the
// otpauth URI the server mints is parsed by `otpauth` and turned into the same
// six digits a phone would show. Nothing is stubbed, so a change to the
// algorithm, the period or the secret encoding fails this test.

test.use({ storageState: { cookies: [], origins: [] } });

test("enrolment, a TOTP sign-in, single-use backup codes, and turning it off", async ({
  browser,
}) => {
  // Three sign-ins and four challenge answers, each rate limited to five a
  // minute across the whole suite; the helpers back off rather than the limits
  // being loosened, so give this room. Plus one TOTP period to roll over.
  test.slow();

  // A member of its own, never the owner: enrolling two-step verification on
  // the shared owner account would put every other spec behind a challenge.
  const member = await createMember(OWNER_SLUG, { tag: "twofa" });

  let uri = "";
  let enrolmentCode = "";
  let backupCodes: string[] = [];

  // ---------------------------------------------------------- enrolment
  const enrolled = await newBrowserContext(browser, {
    storageState: member.state,
  });
  try {
    const page = await enrolled.newPage();
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Two-step verification" }),
    ).toBeVisible();
    await expect(page.getByText("Not set up yet.")).toBeVisible();

    // Step 1: confirm with the password, and the server answers with the URI.
    await page.getByRole("button", { name: "Turn on" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Turn on two-step verification",
    });
    await dialog.getByRole("textbox", { name: "Your password" }).fill(PASSWORD);

    const [setup] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/auth/two-factor/initiate-setup") &&
          r.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Continue" }).click(),
    ]);
    uri = ((await setup.json()) as { uri: string }).uri;
    expect(uri).toContain("otpauth://totp/");

    // Step 2: the QR is there, and the key offered for hand entry is the same
    // secret the URI carries — otherwise "can't scan?" hands out a dead key.
    await expect(
      dialog.getByRole("img", { name: /QR code to scan/ }),
    ).toBeVisible();
    const secret = new URL(
      uri.replace("otpauth://", "https://"),
    ).searchParams.get("secret");
    expect(secret).toBeTruthy();
    await expect(dialog.getByText(secret as string)).toBeVisible();

    enrolmentCode = totpFrom(uri);
    await dialog
      .getByRole("textbox", { name: "6-digit code" })
      .fill(enrolmentCode);
    await dialog.getByRole("button", { name: "Verify code" }).click();

    // Step 3: the one-shot codes, shown exactly once.
    const list = dialog.getByRole("list", { name: "Backup codes" });
    await expect(list).toBeVisible();
    backupCodes = (await list.getByRole("listitem").allTextContents()).map(
      (c) => c.trim(),
    );
    expect(backupCodes.length).toBeGreaterThanOrEqual(2);
    for (const code of backupCodes) expect(code).toContain("-");

    await dialog.getByRole("checkbox", { name: /saved these codes/ }).check();
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.reload();
    await expect(
      page.getByText(
        "You'll be asked for a code when signing in with your password.",
      ),
    ).toBeVisible();
  } finally {
    await enrolled.close();
  }

  // ------------------------------------------------- signing in with TOTP
  const withTotp = await newBrowserContext(browser, {
    storageState: SIGNED_OUT,
  });
  try {
    const page = await withTotp.newPage();
    await signIn(page, member.email);
    // The password alone is no longer enough: it buys a challenge, not a
    // session.
    await expect(page).toHaveURL(/\/two-factor/, { timeout: 15_000 });

    await submitChallengeCode(page, await nextTotp(uri, enrolmentCode));
    await expect(page).toHaveURL(new RegExp(`/${OWNER_SLUG}/inbox`), {
      timeout: 15_000,
    });
  } finally {
    await withTotp.close();
  }

  // ------------------------------------- backup codes: good once, then not
  const withBackup = await newBrowserContext(browser, {
    storageState: SIGNED_OUT,
  });
  try {
    const page = await withBackup.newPage();
    await signIn(page, member.email);
    await expect(page).toHaveURL(/\/two-factor/, { timeout: 15_000 });
    await submitChallengeCode(page, backupCodes[0]);
    await expect(page).toHaveURL(new RegExp(`/${OWNER_SLUG}/inbox`), {
      timeout: 15_000,
    });
  } finally {
    await withBackup.close();
  }

  const lastContext = await newBrowserContext(browser, {
    storageState: SIGNED_OUT,
  });
  try {
    const page = await lastContext.newPage();
    await signIn(page, member.email);
    await expect(page).toHaveURL(/\/two-factor/, { timeout: 15_000 });

    // The code that already let somebody in is spent.
    await submitChallengeCode(page, backupCodes[0]);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/two-factor/);

    // The next one still works.
    await submitChallengeCode(page, backupCodes[1]);
    await expect(page).toHaveURL(new RegExp(`/${OWNER_SLUG}/inbox`), {
      timeout: 15_000,
    });

    // ------------------------------------------------------ and turned off
    await page.goto("/settings");
    await page.getByRole("button", { name: "Turn off" }).click();
    const off = page.getByRole("dialog", {
      name: "Turn off two-step verification?",
    });
    await off.getByRole("textbox", { name: "Your password" }).fill(PASSWORD);
    await off.getByRole("button", { name: "Turn off" }).click();

    await expect(page.getByText("Two-step verification is off.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Not set up yet.")).toBeVisible();
  } finally {
    await lastContext.close();
  }
});
