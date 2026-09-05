import { expect, test } from "./fixtures";
import { freshKey, OWNER_SLUG, OWNER_STATE } from "./helpers";

// The owner's Services screen end to end: a service and its senders are what
// decide whether an inbound email reaches the inbox at all, so every step here
// is driven through the real dialogs rather than the API.

test.use({ storageState: OWNER_STATE });

test("an owner adds a service with senders, renames it and deletes it", async ({
  page,
}) => {
  // Unique per run: a provider key is unique within a household, and this
  // database outlives a single `playwright test`.
  const suffix = freshKey("svc").replace(/^svc-/, "");
  const name = `Streamy ${suffix}`;
  const renamed = `Streamy renamed ${suffix}`;
  const domain = `streamy-${suffix}.test`;
  const exact = `codes@only-${suffix}.test`;

  await page.goto(`/${OWNER_SLUG}/providers`);
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();

  // --- create, with its first sender in the same dialog
  await page.getByRole("button", { name: "Add service" }).first().click();
  const createDialog = page.getByRole("dialog", { name: "Add a service" });
  await createDialog.getByRole("textbox", { name: "Service name" }).fill(name);
  await createDialog
    .getByRole("textbox", { name: "Emails come from (domain)" })
    .fill(domain);
  await createDialog
    .getByRole("button", { name: "Add service", exact: true })
    .click();

  const card = page.getByRole("listitem").filter({ hasText: name });
  await expect(card.getByRole("heading", { name })).toBeVisible();
  await expect(card.getByText(`${domain} · any address`)).toBeVisible();
  await expect(card.getByText("1 sender", { exact: true })).toBeVisible();

  // --- add a second sender, this time an exact address
  await card.getByRole("button", { name: "Add sender" }).click();
  const senderDialog = page.getByRole("dialog", {
    name: `Add a sender for ${name}`,
  });
  await senderDialog
    .getByRole("radio", { name: /Only one exact address/ })
    .check();
  await senderDialog
    .getByRole("textbox", { name: "Email address" })
    .fill(exact);
  await senderDialog
    .getByRole("button", { name: "Add sender", exact: true })
    .click();

  await expect(card.getByText(exact)).toBeVisible();
  await expect(card.getByText("2 senders")).toBeVisible();

  // --- rename
  await card.getByRole("button", { name: `Options for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renameDialog = page.getByRole("dialog", { name: `Rename ${name}` });
  await renameDialog
    .getByRole("textbox", { name: "Service name" })
    .fill(renamed);
  await renameDialog.getByRole("button", { name: "Save name" }).click();

  const renamedCard = page.getByRole("listitem").filter({ hasText: renamed });
  await expect(
    renamedCard.getByRole("heading", { name: renamed }),
  ).toBeVisible();
  // The senders travelled with it — a rename is not a re-create.
  await expect(renamedCard.getByText(`${domain} · any address`)).toBeVisible();

  // --- delete
  await renamedCard
    .getByRole("button", { name: `Options for ${renamed}` })
    .click();
  await page.getByRole("menuitem", { name: "Delete service" }).click();
  await page
    .getByRole("dialog", { name: `Delete ${renamed}?` })
    .getByRole("button", { name: "Delete service" })
    .click();

  await expect(page.getByRole("heading", { name: renamed })).toHaveCount(0);
});

test("a sender has to look like a sender", async ({ page }) => {
  const suffix = freshKey("bad").replace(/^bad-/, "");
  const name = `Badsender ${suffix}`;

  await page.goto(`/${OWNER_SLUG}/providers`);
  await page.getByRole("button", { name: "Add service" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a service" });
  await dialog.getByRole("textbox", { name: "Service name" }).fill(name);
  await dialog
    .getByRole("textbox", { name: "Emails come from (domain)" })
    .fill("not a domain");
  await dialog
    .getByRole("button", { name: "Add service", exact: true })
    .click();

  await expect(
    dialog.getByText(
      "That doesn't look like a domain. Try something like netflix.com.",
    ),
  ).toBeVisible();
  // Nothing was created behind the rejection.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name })).toHaveCount(0);
});
