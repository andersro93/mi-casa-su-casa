import { expect, test } from "./fixtures";
import {
  BASE_URL,
  createService,
  EMAIL_DOMAIN,
  freshEmail,
  freshKey,
  invite,
  mailpit,
  newBrowserContext,
  OWNER_SLUG,
  OWNER_STATE,
  ownerApi,
  PASSWORD,
  postInbound,
  SIGNED_OUT,
} from "./helpers";

// How anybody but the owner gets in. The invitation itself is only half of it:
// what matters is that the link actually arrives (Mailpit), that the account
// created from it lands inside the household, and that it can see exactly the
// services it was given and no others.

test.use({ storageState: OWNER_STATE });

const MAILBOX = `${OWNER_SLUG}@${EMAIL_DOMAIN}`;

/** Two services with a message each, so both are visible in an inbox that is
 * allowed to see them — and the absence of one is evidence, not emptiness. */
async function seedTwoServices(
  request: Parameters<typeof postInbound>[0],
  suffix: string,
) {
  const owner = await ownerApi();
  let granted: Awaited<ReturnType<typeof createService>>;
  let denied: Awaited<ReturnType<typeof createService>>;
  try {
    granted = await createService(owner, OWNER_SLUG, {
      key: `shared-${suffix}`,
      name: `Shared ${suffix}`,
      senderDomain: `shared-${suffix}.test`,
    });
    denied = await createService(owner, OWNER_SLUG, {
      key: `private-${suffix}`,
      name: `Private ${suffix}`,
      senderDomain: `private-${suffix}.test`,
    });
  } finally {
    await owner.dispose();
  }

  for (const service of [granted, denied]) {
    await postInbound(request, {
      to: MAILBOX,
      from: `codes@${service.providerKey}.test`,
      subject: `${service.displayName} code`,
      text: "Your verification code is 111222.",
      spf: "Pass",
      dkim: "Pass",
    });
  }
  return { granted, denied };
}

test("an invitation by email creates an account scoped to the services it named", async ({
  page,
  request,
  browser,
}) => {
  const suffix = freshKey("inv").replace(/^inv-/, "");
  const { granted, denied } = await seedTwoServices(request, suffix);
  const email = freshEmail("invitee");

  await page.goto(`/${OWNER_SLUG}/members`);
  await page.getByRole("button", { name: "Invite someone" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByRole("textbox", { name: "Email address" }).fill(email);
  await dialog.getByRole("textbox", { name: "Name" }).fill("Kari Invitee");
  // Everything is ticked by default; taking one away is what makes the
  // assertion below mean something.
  await dialog
    .getByRole("checkbox", { name: denied.displayName, exact: true })
    .uncheck();
  await expect(
    dialog.getByRole("checkbox", { name: granted.displayName, exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Send invitation" }).click();

  const sent = page.getByRole("dialog", { name: "Invitation sent" });
  await expect(sent.getByText(email)).toBeVisible();
  await sent.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // The link really left the building.
  const mail = await mailpit.lastMessageTo(request, email);
  expect(mail.subject).toContain("invited you to Mi Casa Su Casa");
  expect(mail.link).toContain("/invite/");

  // A brand-new visitor opens it and makes their account.
  // Explicitly signed out: `browser.newContext()` inherits this file's
  // `test.use({ storageState: OWNER_STATE })`, and an invitee who arrives as
  // the owner is shown "this invitation is for a different account" instead.
  const invitee = await newBrowserContext(browser, {
    storageState: SIGNED_OUT,
  });
  try {
    const page2 = await invitee.newPage();
    await page2.goto(mail.link);
    await expect(
      page2.getByRole("heading", { name: /invited you to/ }),
    ).toBeVisible();
    await page2
      .getByRole("textbox", { name: "Your name" })
      .fill("Kari Invitee");
    await page2
      .getByRole("textbox", { name: "Choose a password" })
      .fill(PASSWORD);
    await page2
      .getByRole("button", { name: "Create account and join" })
      .click();

    await expect(page2).toHaveURL(new RegExp(`/${OWNER_SLUG}/inbox`), {
      timeout: 15_000,
    });

    // Scoped, not blanket: one service is theirs, the other does not exist as
    // far as they are concerned.
    const services = page2.getByRole("list", { name: "Services" });
    await expect(services.getByText(granted.displayName).first()).toBeVisible();
    await expect(services.getByText(denied.displayName)).toHaveCount(0);
  } finally {
    await invitee.close();
  }
});

test("an invitation the email could not carry is handed over as a link", async ({
  page,
}) => {
  // Mailpit is started with --smtp-allowed-recipients=@e2e\.test$, so this
  // address is refused at RCPT TO — the same failure a real relay produces for
  // an unroutable domain, and the reason the "share it yourself" path exists.
  const unreachable = `${freshKey("blocked")}@unreachable.test`;

  await page.goto(`/${OWNER_SLUG}/members`);
  await page.getByRole("button", { name: "Invite someone" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog
    .getByRole("textbox", { name: "Email address" })
    .fill(unreachable);
  await dialog.getByRole("textbox", { name: "Name" }).fill("Unreachable");
  await dialog.getByRole("button", { name: "Send invitation" }).click();

  const shared = page.getByRole("dialog", {
    name: "Share this invitation link",
  });
  const link = shared.getByRole("textbox", { name: "Invitation link" });
  await expect(link).toHaveValue(new RegExp(`^${BASE_URL}/invite/.+`));

  // The invitation itself stands — only the delivery failed.
  await shared.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await link.inputValue(),
  );
  await shared.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(unreachable)).toBeVisible();
});

test("resending an invitation mails a new link and kills the old one", async ({
  page,
  request,
}) => {
  const email = freshEmail("resend");
  const owner = await ownerApi();
  let first: Awaited<ReturnType<typeof invite>>;
  try {
    first = await invite(owner, OWNER_SLUG, { email, name: "Resend Target" });
  } finally {
    await owner.dispose();
  }
  const firstMail = await mailpit.lastMessageTo(request, email);

  await page.goto(`/${OWNER_SLUG}/members`);
  const pending = page
    .getByRole("list", { name: "Pending invitations" })
    .getByRole("listitem")
    .filter({ hasText: email });
  await pending.getByRole("button", { name: "Resend" }).click();
  await expect(page.getByText(`Invitation resent to ${email}.`)).toBeVisible();

  const secondMail = await mailpit.lastMessageTo(request, email, {
    after: firstMail.id,
  });
  expect(secondMail.link).not.toBe(first.url);
  expect(secondMail.link).toContain("/invite/");

  // The first link is dead: a resend is a replacement, which is what makes it
  // safe to offer after a link has gone to the wrong inbox.
  await page.goto(first.url);
  await expect(
    page.getByRole("heading", { name: /isn't available any more/ }),
  ).toBeVisible();
});

test("cancelling an invitation stops its link working", async ({ page }) => {
  const email = freshEmail("cancel");
  const owner = await ownerApi();
  let invitation: Awaited<ReturnType<typeof invite>>;
  try {
    invitation = await invite(owner, OWNER_SLUG, {
      email,
      name: "Cancel Target",
    });
  } finally {
    await owner.dispose();
  }

  await page.goto(`/${OWNER_SLUG}/members`);
  const pending = page
    .getByRole("list", { name: "Pending invitations" })
    .getByRole("listitem")
    .filter({ hasText: email });
  await pending.getByRole("button", { name: "Cancel invitation" }).click();
  await page
    .getByRole("dialog", { name: /Cancel the invitation for/ })
    .getByRole("button", { name: "Cancel invitation" })
    .click();

  await expect(page.getByText("Invitation cancelled.")).toBeVisible();
  await expect(pending).toHaveCount(0);

  await page.goto(invitation.url);
  await expect(
    page.getByRole("heading", { name: /isn't available any more/ }),
  ).toBeVisible();
});
