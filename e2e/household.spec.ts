import { expect, test } from "./fixtures";
import { EMAIL_DOMAIN, freshKey, OWNER_SLUG, OWNER_STATE } from "./helpers";

// A household IS an email address: the slug the owner picks becomes
// <slug>@EMAIL_DOMAIN, which is what gets typed into Netflix. So the address
// on screen has to be the real one, and copyable — and a second household has
// to get its own without disturbing the first.

test.use({ storageState: OWNER_STATE });

test("the household settings show the real inbox address, ready to copy", async ({
  page,
}) => {
  await page.goto(`/${OWNER_SLUG}/settings`);
  await expect(
    page.getByRole("heading", { name: "Inbox address" }),
  ).toBeVisible();

  const address = `${OWNER_SLUG}@${EMAIL_DOMAIN}`;
  await expect(page.getByText(address)).toBeVisible();

  await page.getByRole("button", { name: "Copy address" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    address,
  );
});

test("an owner creates a second household and renames it", async ({ page }) => {
  const suffix = freshKey("hh").replace(/^hh-/, "");
  // Named to sort AFTER the owner's first household: the switcher orders by
  // lower(display_name), and "the first household" is where every other spec
  // expects `/` to land.
  const name = `Zzz Holiday ${suffix}`;
  const renamed = `Zzz Renamed ${suffix}`;
  const slug = `zzz-${suffix}`;

  await page.goto("/new-household");
  await page.getByRole("textbox", { name: "Household name" }).fill(name);
  await page.getByRole("textbox", { name: "Inbox address" }).fill(slug);
  await page.getByRole("button", { name: "Create household" }).click();

  await expect(page).toHaveURL(new RegExp(`/${slug}/inbox`), {
    timeout: 15_000,
  });

  // Its own mailbox, on the same domain.
  await page.goto(`/${slug}/settings`);
  await expect(page.getByText(`${slug}@${EMAIL_DOMAIN}`)).toBeVisible();

  // --- rename
  await page.getByRole("textbox", { name: "Household name" }).fill(renamed);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Household renamed.")).toBeVisible();

  // Persisted, not just repainted — and the address is untouched, which is the
  // promise the screen makes ("The inbox address stays the same").
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Household name" }),
  ).toHaveValue(renamed);
  await expect(page.getByText(`${slug}@${EMAIL_DOMAIN}`)).toBeVisible();
});
