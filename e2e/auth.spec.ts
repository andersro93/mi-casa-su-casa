import { expect, test } from "./fixtures";
import {
  apiSignIn,
  createMember,
  newBrowserContext,
  OWNER_EMAIL,
  OWNER_SLUG,
  PASSWORD,
  SIGNED_OUT,
  signIn,
  signOut,
} from "./helpers";

// The seam no unit test sees: the limen-auth client driving the real login
// screen against the real server, and the session that comes out of it living
// in a real cookie jar.

test.describe("the login screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signs the owner in and lands in their household inbox", async ({
    page,
  }) => {
    await signIn(page, OWNER_EMAIL, PASSWORD);

    await expect(page).toHaveURL(new RegExp(`/${OWNER_SLUG}/inbox`), {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", { name: "Latest codes" }),
    ).toBeVisible();
  });

  test("rejects a wrong password and stays put", async ({ page }) => {
    await signIn(page, OWNER_EMAIL, "not-the-right-password");

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    // Still nobody: the protected route bounces straight back.
    await page.goto(`/${OWNER_SLUG}/inbox`).catch(() => {});
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("signing out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Deliberately NOT the owner: global-setup.ts's owner session is shared by
  // every owner-only spec, and signing it out here would revoke it for all of
  // them. A member created for this test alone has nothing else depending on
  // it.
  test("signs out from the account menu and the session is really gone", async ({
    browser,
  }) => {
    const member = await createMember(OWNER_SLUG, { tag: "signout" });
    const context = await newBrowserContext(browser, {
      storageState: member.state,
    });

    try {
      const page = await context.newPage();
      await page.goto(`/${OWNER_SLUG}/inbox`);
      await expect(
        page.getByRole("heading", { name: "Latest codes" }),
      ).toBeVisible();

      await signOut(page);

      // The SPA's own redirect aborts the navigation — that abort IS the
      // evidence, so swallow it and assert where the browser ended up.
      await page.goto(`/${OWNER_SLUG}/inbox`).catch(() => {});
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    } finally {
      await context.close();
    }
  });
});

test.describe("session revocation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signing out everywhere else kills the other device's session", async ({
    browser,
  }) => {
    // A member of the owner's household, created through the invitation flow
    // so nothing here depends on the owner's own session surviving the test.
    const member = await createMember(OWNER_SLUG, { tag: "revoke" });

    const laptop = await newBrowserContext(browser, {
      storageState: member.state,
    });
    const phone = await newBrowserContext(browser, {
      storageState: SIGNED_OUT,
    });

    try {
      // Two genuine sessions for one account: the one acceptance minted, and
      // a second from a fresh sign-in on another device.
      await apiSignIn(phone.request, member.email);

      const phonePage = await phone.newPage();
      await phonePage.goto(`/${OWNER_SLUG}/inbox`);
      await expect(
        phonePage.getByRole("heading", { name: "Latest codes" }),
      ).toBeVisible();

      const laptopPage = await laptop.newPage();
      await laptopPage.goto("/settings");
      const devices = laptopPage.getByRole("list", {
        name: "Signed-in devices",
      });
      await expect(devices.getByRole("listitem")).toHaveCount(2);

      await laptopPage
        .getByRole("button", { name: "Sign out everywhere else" })
        .click();
      await laptopPage.getByRole("button", { name: "Sign out others" }).click();
      await expect(
        laptopPage.getByText("Only this device is signed in."),
      ).toBeVisible();

      // The revoked device is out: its next navigation bounces to sign-in.
      await phonePage.goto(`/${OWNER_SLUG}/inbox`).catch(() => {});
      await expect(phonePage).toHaveURL(/\/login/, { timeout: 15_000 });
    } finally {
      await phone.close();
      await laptop.close();
    }
  });
});
