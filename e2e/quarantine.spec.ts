import { expect, test } from "./fixtures";
import {
  createService,
  EMAIL_DOMAIN,
  freshKey,
  OWNER_SLUG,
  OWNER_STATE,
  ownerApi,
  postInbound,
} from "./helpers";

// Needs review is the household's safety net: everything the classifier would
// not file on its own waits here until an owner decides. Both decisions are
// driven through the screen, and both are checked by their consequence — where
// the message ends up next — rather than by the toast alone.

test.use({ storageState: OWNER_STATE });

const MAILBOX = `${OWNER_SLUG}@${EMAIL_DOMAIN}`;

test("an owner files an unknown sender under a service and the rule sticks", async ({
  page,
  request,
}) => {
  const suffix = freshKey("rel").replace(/^rel-/, "");
  const key = `rel-${suffix}`;
  const name = `Release ${suffix}`;
  const unknown = `unknown-${suffix}.test`;
  const first = `First ${suffix} code`;
  const second = `Second ${suffix} code`;

  const owner = await ownerApi();
  try {
    // No sender rule: the service exists, but nothing points at it yet.
    await createService(owner, OWNER_SLUG, { key, name });
  } finally {
    await owner.dispose();
  }

  await postInbound(request, {
    to: MAILBOX,
    from: `codes@${unknown}`,
    subject: first,
    text: "Your verification code is 135791.",
    spf: "Pass",
    dkim: "Pass",
  });

  await page.goto(`/${OWNER_SLUG}/quarantine`);
  const item = page
    .getByRole("list", { name: "Emails needing review" })
    .getByRole("listitem")
    .filter({ hasText: first });
  await expect(item.getByText("Unknown sender").first()).toBeVisible();

  await item
    .getByRole("button", { name: new RegExp(first) })
    .first()
    .click();
  await expect(
    item.getByText("Your verification code is 135791."),
  ).toBeVisible();
  await item.getByRole("button", { name: "File under a service…" }).click();

  const dialog = page.getByRole("dialog", { name: "File under a service" });
  await dialog.getByRole("combobox", { name: "Service" }).click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  // Left checked on purpose: filing is also how a household teaches the app a
  // sender, and the second delivery below is what proves it was learnt.
  await expect(
    dialog.getByRole("checkbox", { name: new RegExp(unknown) }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "File email" }).click();

  await expect(page.getByText(`Filed under ${name}.`)).toBeVisible();
  await expect(item).toHaveCount(0);

  // Released: it is in the service's inbox now, code and all.
  await page.goto(`/${OWNER_SLUG}/inbox/${key}`);
  await expect(page.getByText(first).first()).toBeVisible();
  await expect(page.getByLabel("Code 1 3 5 7 9 1").first()).toBeVisible();

  // And the sender was remembered: the next one is filed without an owner.
  await postInbound(request, {
    to: MAILBOX,
    from: `codes@${unknown}`,
    subject: second,
    text: "Your verification code is 246802.",
    spf: "Pass",
    dkim: "Pass",
  });
  await page.goto(`/${OWNER_SLUG}/inbox/${key}`);
  await expect(page.getByText(second).first()).toBeVisible();
  await page.goto(`/${OWNER_SLUG}/quarantine`);
  await expect(page.getByText(second)).toHaveCount(0);
});

test("an owner hides an email and it leaves the queue for good", async ({
  page,
  request,
}) => {
  const suffix = freshKey("hide").replace(/^hide-/, "");
  const subject = `Junk ${suffix}`;

  await postInbound(request, {
    to: MAILBOX,
    from: `noise@junk-${suffix}.test`,
    subject,
    text: "Your verification code is 864209.",
    spf: "Pass",
    dkim: "Pass",
  });

  await page.goto(`/${OWNER_SLUG}/quarantine`);
  const item = page
    .getByRole("list", { name: "Emails needing review" })
    .getByRole("listitem")
    .filter({ hasText: subject });
  await expect(item).toHaveCount(1);

  await item
    .getByRole("button", { name: new RegExp(subject) })
    .first()
    .click();
  await item.getByRole("button", { name: "Hide this email" }).click();
  await page
    .getByRole("dialog", { name: "Hide this email?" })
    .getByRole("button", { name: "Hide email" })
    .click();

  await expect(page.getByText("Email hidden.")).toBeVisible();
  await expect(item).toHaveCount(0);

  // Still gone after a reload: the decision is in the database, not in a cache.
  await page.reload();
  await expect(page.getByText(subject)).toHaveCount(0);
});
