import { SELF } from "cloudflare:test";
import { createHousehold } from "@server/db/repositories/households";
import { createHouseholdInvitation } from "@server/db/repositories/invitations";
import { hashInvitationToken } from "@server/security/tokens";
import { describe, expect, it } from "vitest";

import { count, createTestUser, db } from "./helpers";

async function seedInvitation(email = "kid@example.com") {
  const owner = await createTestUser({ email: "owner@example.com" });
  const household = await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId: owner.id,
  });
  const token = "invite-token-1";
  await createHouseholdInvitation(db, {
    householdId: household?.id ?? "",
    email,
    name: "Kid",
    role: "member",
    tokenHash: await hashInvitationToken(token),
    invitedByUserId: owner.id,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    providerIds: [],
  });
  return { token, householdId: household?.id ?? "" };
}

async function postAccept(token: string, body: unknown) {
  return SELF.fetch(`http://localhost:8787/api/invitations/${token}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("invitation acceptance (end-to-end against D1)", () => {
  it("creates the account, the membership and marks the invitation accepted", async () => {
    const { token } = await seedInvitation();

    const response = await postAccept(token, {
      name: "Kid",
      password: "averylongpassword123",
    });

    expect(response.status).toBe(201);
    expect(await count("user", "email = ?1", "kid@example.com")).toBe(1);
    expect(await count("household_memberships", "role = 'member'")).toBe(1);
    expect(await count("household_invitations", "status = 'accepted'")).toBe(1);
  });

  it("tells an existing account holder to sign in instead of failing with 'user already exists'", async () => {
    const { token } = await seedInvitation();
    await createTestUser({ email: "kid@example.com" });

    const response = await postAccept(token, {
      name: "Kid",
      password: "averylongpassword123",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_EXISTS",
    });
    // Nothing was accepted or created.
    expect(await count("household_invitations", "status = 'pending'")).toBe(1);
    expect(await count("user")).toBe(2);
  });

  it("rejects unknown tokens without side effects", async () => {
    await seedInvitation();
    const response = await postAccept("nope", {
      name: "Kid",
      password: "averylongpassword123",
    });
    expect(response.status).toBe(404);
    expect(await count("user")).toBe(1);
  });
});
