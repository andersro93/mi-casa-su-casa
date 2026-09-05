import { expect, test } from "./fixtures";
import {
  createMember,
  createService,
  freshKey,
  OWNER_HOUSEHOLD,
  OWNER_SLUG,
  OWNER_STATE,
  ownerApi,
} from "./helpers";

// Who is in the household and what each of them can see. Access is the whole
// security model on the member side, so every change here is asserted on the
// row's own summary line — the thing an owner actually reads — rather than on
// a toast.

test.use({ storageState: OWNER_STATE });

test("an owner grants access, promotes a member and removes them", async ({
  page,
}) => {
  const suffix = freshKey("acc").replace(/^acc-/, "");
  const serviceName = `Access ${suffix}`;

  const owner = await ownerApi();
  try {
    await createService(owner, OWNER_SLUG, {
      key: `access-${suffix}`,
      name: serviceName,
      senderDomain: `access-${suffix}.test`,
    });
  } finally {
    await owner.dispose();
  }

  // Invited with no services at all, which the screen calls out in warning
  // colour — the state this test then walks out of.
  const member = await createMember(OWNER_SLUG, { tag: `grant${suffix}` });

  await page.goto(`/${OWNER_SLUG}/members`);
  const row = page
    .getByRole("list", { name: "Members" })
    .getByRole("listitem")
    .filter({ hasText: member.email });
  await expect(row.getByText("Can't see any services yet")).toBeVisible();

  // --- grant one service
  await row.getByRole("button", { name: `Options for ${member.name}` }).click();
  await page
    .getByRole("menuitem", { name: "Change what they can see" })
    .click();
  const access = page.getByRole("dialog", {
    name: `What can ${member.name} see?`,
  });
  await access
    .getByRole("checkbox", { name: serviceName, exact: true })
    .check();
  await access.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText(`Updated what ${member.name} can see.`),
  ).toBeVisible();
  await expect(row.getByText(`Can see: ${serviceName}`)).toBeVisible();

  // --- and take it away again: the same dialog, unticked
  await row.getByRole("button", { name: `Options for ${member.name}` }).click();
  await page
    .getByRole("menuitem", { name: "Change what they can see" })
    .click();
  await access
    .getByRole("checkbox", { name: serviceName, exact: true })
    .uncheck();
  await access.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("Can't see any services yet")).toBeVisible();

  // Grant it back, so the promotion below is a change of role and not a
  // change of scope.
  await row.getByRole("button", { name: `Options for ${member.name}` }).click();
  await page
    .getByRole("menuitem", { name: "Change what they can see" })
    .click();
  await access
    .getByRole("checkbox", { name: serviceName, exact: true })
    .check();
  await access.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText(`Can see: ${serviceName}`)).toBeVisible();

  // --- promote to owner: scoping stops applying at all
  await row.getByRole("button", { name: `Options for ${member.name}` }).click();
  await page.getByRole("menuitem", { name: "Make owner" }).click();
  await page
    .getByRole("dialog", { name: `Make ${member.name} an owner?` })
    .getByRole("button", { name: "Make owner" })
    .click();

  await expect(page.getByText(`${member.name} is now an owner.`)).toBeVisible();
  await expect(row.getByText("Owner")).toBeVisible();
  await expect(row.getByText("Can see everything")).toBeVisible();

  // --- and out again
  await row.getByRole("button", { name: `Options for ${member.name}` }).click();
  await page.getByRole("menuitem", { name: "Remove from household" }).click();
  await page
    .getByRole("dialog", { name: `Remove ${member.name}?` })
    .getByRole("button", { name: "Remove", exact: true })
    .click();

  await expect(page.getByText(`${member.name} removed.`)).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("the only owner cannot leave the household", async ({ page }) => {
  await page.goto("/settings");

  const households = page.getByRole("list", { name: "Households" });
  const row = households
    .getByRole("listitem")
    .filter({ hasText: OWNER_HOUSEHOLD });
  await row.getByRole("button", { name: "Leave" }).click();

  const dialog = page.getByRole("dialog", {
    name: `Leave ${OWNER_HOUSEHOLD}?`,
  });
  await dialog.getByRole("button", { name: "Leave household" }).click();

  // Refused, and said so in the dialog rather than silently doing nothing.
  await expect(dialog.getByText(/only owner of this household/)).toBeVisible();

  // Still theirs after a reload: the refusal was the server's, not the SPA's.
  await page.reload();
  await expect(
    households.getByRole("listitem").filter({ hasText: OWNER_HOUSEHOLD }),
  ).toHaveCount(1);
});
