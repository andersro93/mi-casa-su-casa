import {
  addUserToHousehold,
  getHouseholdBySlug,
  listHouseholdsForUser,
  userBelongsToHousehold,
} from "@server/db/repositories/households";
import { describe, expect, it } from "vitest";

import { createTestUser, db, insertHousehold } from "./helpers";

describe("household membership (D1)", () => {
  it("resolves membership by slug and upserts role changes", async () => {
    const user = await createTestUser({ email: "member@example.com" });
    const household = await insertHousehold({
      slug: "casa",
      displayName: "Casa",
    });

    expect(await userBelongsToHousehold(db, user.id, "casa")).toBeNull();

    await addUserToHousehold(db, {
      householdId: household.id,
      userId: user.id,
      role: "member",
    });
    expect(await userBelongsToHousehold(db, user.id, "casa")).toMatchObject({
      householdId: household.id,
      role: "member",
      slug: "casa",
    });

    await addUserToHousehold(db, {
      householdId: household.id,
      userId: user.id,
      role: "owner",
    });
    expect(await userBelongsToHousehold(db, user.id, "casa")).toMatchObject({
      role: "owner",
    });

    const households = await listHouseholdsForUser(db, user.id);
    expect(households).toEqual([
      expect.objectContaining({
        slug: "casa",
        displayName: "Casa",
        role: "owner",
      }),
    ]);
  });

  it("looks up households by slug", async () => {
    await insertHousehold({ slug: "casa" });
    expect(await getHouseholdBySlug(db, "casa")).toMatchObject({
      slug: "casa",
    });
    expect(await getHouseholdBySlug(db, "nope")).toBeNull();
  });
});
