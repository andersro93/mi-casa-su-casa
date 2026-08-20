import {
  createHousehold,
  userBelongsToHousehold,
} from "@server/db/repositories/households";
import {
  acceptInvitation,
  createHouseholdInvitation,
  getInvitationByTokenHash,
  getProvidersForInvitation,
  replaceInvitationProviders,
} from "@server/db/repositories/invitations";
import { createProvider } from "@server/db/repositories/provider-rules";
import { describe, expect, it } from "vitest";

import { count, createTestUser, db } from "./helpers";

const inAWeek = () =>
  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

async function createOwnedHousehold(ownerUserId: string) {
  const household = await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId,
  });
  if (!household) {
    throw new Error("household was not created");
  }
  return household;
}

describe("households + invitations multi-statement writes (D1)", () => {
  it("createHousehold inserts the household and the owner membership", async () => {
    const owner = await createTestUser({ email: "owner@example.com" });

    const household = await createHousehold(db, {
      slug: "casa",
      displayName: "Casa",
      ownerUserId: owner.id,
    });

    expect(household).toMatchObject({ slug: "casa", displayName: "Casa" });
    expect(await userBelongsToHousehold(db, owner.id, "casa")).toMatchObject({
      role: "owner",
    });
    expect(await count("households")).toBe(1);
    expect(await count("household_memberships")).toBe(1);
  });

  it("createHouseholdInvitation stores the invitation with its provider scope", async () => {
    const owner = await createTestUser({ email: "owner@example.com" });
    const household = await createOwnedHousehold(owner.id);
    const netflix = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    const spotify = await createProvider(
      db,
      household.id,
      "spotify",
      "Spotify",
    );

    const invitationId = await createHouseholdInvitation(db, {
      householdId: household.id,
      email: "kid@example.com",
      name: "Kid",
      role: "member",
      tokenHash: "hash-1",
      invitedByUserId: owner.id,
      expiresAt: inAWeek(),
      providerIds: [netflix.id, spotify.id],
    });

    const invitation = await getInvitationByTokenHash(db, "hash-1");
    expect(invitation).toMatchObject({
      id: invitationId,
      email: "kid@example.com",
      status: "pending",
      role: "member",
    });
    const scoped = await getProvidersForInvitation(db, invitationId);
    expect(scoped.map((p) => p.provider_key).sort()).toEqual([
      "netflix",
      "spotify",
    ]);

    // No provider scope is also valid.
    await createHouseholdInvitation(db, {
      householdId: household.id,
      email: "other@example.com",
      name: "Other",
      role: "member",
      tokenHash: "hash-2",
      invitedByUserId: owner.id,
      expiresAt: inAWeek(),
      providerIds: [],
    });
    expect(await count("household_invitations")).toBe(2);
  });

  it("replaceInvitationProviders swaps the provider scope atomically", async () => {
    const owner = await createTestUser({ email: "owner@example.com" });
    const household = await createOwnedHousehold(owner.id);
    const netflix = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    const spotify = await createProvider(
      db,
      household.id,
      "spotify",
      "Spotify",
    );
    const invitationId = await createHouseholdInvitation(db, {
      householdId: household.id,
      email: "kid@example.com",
      name: "Kid",
      role: "member",
      tokenHash: "hash-1",
      invitedByUserId: owner.id,
      expiresAt: inAWeek(),
      providerIds: [netflix.id],
    });

    await replaceInvitationProviders(db, invitationId, [spotify.id]);
    expect(
      (await getProvidersForInvitation(db, invitationId)).map(
        (p) => p.provider_key,
      ),
    ).toEqual(["spotify"]);

    await replaceInvitationProviders(db, invitationId, []);
    expect(await getProvidersForInvitation(db, invitationId)).toEqual([]);
  });

  it("acceptInvitation creates the membership, marks the invitation accepted, and is idempotent on re-accept", async () => {
    const owner = await createTestUser({ email: "owner@example.com" });
    const kid = await createTestUser({ email: "kid@example.com" });
    const household = await createOwnedHousehold(owner.id);
    const invitationId = await createHouseholdInvitation(db, {
      householdId: household.id,
      email: "kid@example.com",
      name: "Kid",
      role: "member",
      tokenHash: "hash-1",
      invitedByUserId: owner.id,
      expiresAt: inAWeek(),
      providerIds: [],
    });

    await acceptInvitation(db, {
      invitationId,
      householdId: household.id,
      acceptedByUserId: kid.id,
      role: "member",
    });

    expect(await userBelongsToHousehold(db, kid.id, "casa")).toMatchObject({
      role: "member",
    });
    expect(await getInvitationByTokenHash(db, "hash-1")).toMatchObject({
      status: "accepted",
      acceptedByUserId: kid.id,
    });

    // Re-accepting with a higher role upserts the membership instead of failing.
    await acceptInvitation(db, {
      invitationId,
      householdId: household.id,
      acceptedByUserId: kid.id,
      role: "owner",
    });
    expect(await userBelongsToHousehold(db, kid.id, "casa")).toMatchObject({
      role: "owner",
    });
    expect(await count("household_memberships")).toBe(2);
  });
});
