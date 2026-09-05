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

// The whole point of the product, driven end to end: a service, a signed
// Mailgun webhook carrying a real RFC 5322 message, and the code coming out
// the other side on screen — through the parser, the classifier and the
// extractor, none of which the SPA can fake.
//
// This is the one spec both projects run (playwright.config.ts): the inbox is
// a card stack on a phone and a list-plus-detail on a desktop, and the service
// view below is reached the same way in both.

test.use({ storageState: OWNER_STATE });

/** Mailbox for the owner's household — the address a service would be given. */
const MAILBOX = `${OWNER_SLUG}@${EMAIL_DOMAIN}`;

test("an inbound code reaches the inbox, copies, and marks itself used", async ({
  page,
  request,
}) => {
  const suffix = freshKey("inbox").replace(/^inbox-/, "");
  const key = `inbox-${suffix}`;
  const name = `Inbox ${suffix}`;
  const senderDomain = `inbox-${suffix}.test`;
  const code = "314159";
  const subject = `Your ${name} sign-in code`;

  const owner = await ownerApi();
  try {
    await createService(owner, OWNER_SLUG, { key, name, senderDomain });
  } finally {
    await owner.dispose();
  }

  await postInbound(request, {
    to: MAILBOX,
    from: `codes@${senderDomain}`,
    subject,
    text: `Hi there,\n\nYour verification code is ${code}.\n\nThanks.`,
    // Both annotations pass, so the verdict trusts the sender whichever of the
    // envelope or the From header the rule matched on.
    spf: "Pass",
    dkim: "Pass",
  });

  // The service list: the household sees the new service with its message.
  await page.goto(`/${OWNER_SLUG}/inbox`);
  await expect(
    page.getByRole("heading", { name: "Latest codes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Services" }).getByText(name).first(),
  ).toBeVisible();

  // The service itself: same route on both layouts.
  await page.goto(`/${OWNER_SLUG}/inbox/${key}`);
  // `exact` because the message accordions below carry the service name in
  // their subjects too.
  await expect(
    page.getByRole("heading", { name, exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(subject).first()).toBeVisible();
  // Rendered grouped for readability; the value copied is the raw code.
  await expect(
    page.getByLabel(`Code ${code.split("").join(" ")}`).first(),
  ).toBeVisible();
  await expect(page.getByText("Latest code", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy code" }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // Copying IS using it: the message flips to "used" without a second action.
  await expect(page.getByText("Latest code · used")).toBeVisible();
});

test("a message that fails the sender checks goes to Needs review, not the inbox", async ({
  page,
  request,
}) => {
  const suffix = freshKey("spf").replace(/^spf-/, "");
  const key = `spf-${suffix}`;
  const name = `Spoofed ${suffix}`;
  const senderDomain = `spf-${suffix}.test`;
  const good = `Genuine ${suffix} code`;
  const forged = `Forged ${suffix} code`;

  const owner = await ownerApi();
  try {
    await createService(owner, OWNER_SLUG, { key, name, senderDomain });
  } finally {
    await owner.dispose();
  }

  // Same service, same sender domain — only the authentication differs.
  await postInbound(request, {
    to: MAILBOX,
    from: `codes@${senderDomain}`,
    subject: good,
    text: "Your verification code is 246800.",
    spf: "Pass",
    dkim: "Pass",
  });
  await postInbound(request, {
    to: MAILBOX,
    from: `codes@${senderDomain}`,
    subject: forged,
    text: "Your verification code is 999111.",
    spf: "Fail",
    dkim: "Fail",
  });

  // The inbox keeps the genuine one and never shows the forged one.
  await page.goto(`/${OWNER_SLUG}/inbox/${key}`);
  await expect(page.getByText(good).first()).toBeVisible();
  await expect(page.getByText(forged)).toHaveCount(0);

  // The forged one is waiting for the owner, labelled for what it is.
  await page.goto(`/${OWNER_SLUG}/quarantine`);
  const queue = page.getByRole("list", { name: "Emails needing review" });
  const item = queue.getByRole("listitem").filter({ hasText: forged });
  await expect(item).toHaveCount(1);
  await expect(item.getByText("Sender check failed").first()).toBeVisible();
});
