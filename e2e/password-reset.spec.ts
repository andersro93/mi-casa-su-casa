import { expect, test } from "./fixtures";
import {
  createMember,
  mailpit,
  newBrowserContext,
  OWNER_SLUG,
  signIn,
} from "./helpers";

// Forgotten password, all the way through the real mail: request, link out of
// Mailpit, new password, and — the part that matters for security rather than
// convenience — every other session dropped on the way.

test.use({ storageState: { cookies: [], origins: [] } });

const NEW_PASSWORD = "e2e-newpass-98765";

test("a reset link sets a new password and drops the old session", async ({
  page,
  request,
  browser,
}) => {
  // Never the owner: global-setup.ts's owner session and password are shared
  // by every owner-only spec in the suite.
  const member = await createMember(OWNER_SLUG, { tag: "reset" });
  // The invitation mail is already sitting in this mailbox; remember it so the
  // wait below is for the RESET mail and not for that one.
  const invitationMail = await mailpit.lastMessageTo(request, member.email);

  await page.goto("/forgot-password");
  await page.getByRole("textbox", { name: "Email Address" }).fill(member.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();

  const mail = await mailpit.lastMessageTo(request, member.email, {
    after: invitationMail.id,
  });
  expect(mail.subject).toBe("Reset your Mi Casa Su Casa password");
  expect(mail.link).toContain("/reset-password?token=");

  await page.goto(mail.link);
  await page
    .getByRole("textbox", { name: "New password", exact: true })
    .fill(NEW_PASSWORD);
  await page
    .getByRole("textbox", { name: "Confirm new password" })
    .fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByText(
      "Your password has been updated. You can sign in with it now.",
    ),
  ).toBeVisible();

  // The session the account already had is gone — that is what makes a reset
  // a recovery rather than a second key for whoever had the first.
  const stale = await newBrowserContext(browser, {
    storageState: member.state,
  });
  try {
    const stalePage = await stale.newPage();
    await stalePage.goto(`/${OWNER_SLUG}/inbox`).catch(() => {});
    await expect(stalePage).toHaveURL(/\/login/, { timeout: 15_000 });
  } finally {
    await stale.close();
  }

  // And the new password is the one that works now.
  await signIn(page, member.email, NEW_PASSWORD);
  await expect(page).toHaveURL(new RegExp(`/${OWNER_SLUG}/inbox`), {
    timeout: 15_000,
  });
});
