import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import { createHousehold } from "@server/db/repositories/households";
import { createHouseholdInvitation } from "@server/db/repositories/invitations";
import { createProvider } from "@server/db/repositories/provider-rules";
import { hashInvitationToken } from "@server/security/tokens";
import { describe, expect, it } from "vitest";

import { count, createTestUser, db, testEnv } from "./helpers";

async function seedInvitation(email = "kid@example.com", withProvider = false) {
  const owner = await createTestUser({ email: "owner@example.com" });
  const household = await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId: owner.id,
  });
  const householdId = household?.id ?? "";
  const providerIds: string[] = [];
  if (withProvider) {
    const provider = await createProvider(
      db,
      householdId,
      "netflix",
      "Netflix",
    );
    providerIds.push(provider.id);
  }
  const token = "invite-token-1";
  await createHouseholdInvitation(db, {
    householdId,
    email,
    name: "Kid",
    role: "member",
    tokenHash: await hashInvitationToken(token),
    invitedByUserId: owner.id,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    providerIds,
  });
  return { token, householdId };
}

async function signUpWithCookie(email: string) {
  const result = await provisioningAuthForEnv(testEnv()).api.signUpEmail({
    body: { email, name: "Existing", password: "averylongpassword123" },
    returnHeaders: true,
  });
  return result.headers
    .getSetCookie()
    .map((entry: string) => entry.split(";")[0])
    .join("; ");
}

async function postAccept(token: string, body: unknown) {
  return SELF.fetch("http://localhost:8787/api/invitations/accept", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-invitation-token": token,
    },
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

  it("lets a signed-in user with the invited email accept without a password and copies provider access", async () => {
    const { token, householdId } = await seedInvitation(
      "kid@example.com",
      true,
    );
    const cookie = await signUpWithCookie("kid@example.com");

    const lookup = await SELF.fetch(
      "http://localhost:8787/api/invitations/lookup",
      {
        headers: { cookie, "x-invitation-token": token },
      },
    );
    await expect(lookup.json()).resolves.toMatchObject({
      accountExists: true,
      viewer: { email: "kid@example.com", emailMatches: true },
      // The page greets newcomers with who invited them and to what.
      household: { displayName: expect.any(String) },
      invitedBy: { name: expect.any(String) },
    });

    const response = await SELF.fetch(
      "http://localhost:8787/api/invitations/accept",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-invitation-token": token,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      member: { email: "kid@example.com", role: "member" },
      household: { slug: "casa" },
    });
    expect(
      await count(
        "household_memberships",
        "household_id = ?1 AND role = 'member'",
        householdId,
      ),
    ).toBe(1);
    expect(await count("household_member_provider_access")).toBe(1);
    expect(await count("household_invitations", "status = 'accepted'")).toBe(1);
  });

  it("refuses acceptance by a signed-in user with a different email", async () => {
    const { token } = await seedInvitation("kid@example.com");
    const cookie = await signUpWithCookie("someone-else@example.com");

    const lookup = await SELF.fetch(
      "http://localhost:8787/api/invitations/lookup",
      {
        headers: { cookie, "x-invitation-token": token },
      },
    );
    await expect(lookup.json()).resolves.toMatchObject({
      viewer: { email: "someone-else@example.com", emailMatches: false },
    });

    const response = await SELF.fetch(
      "http://localhost:8787/api/invitations/accept",
      { method: "POST", headers: { cookie, "x-invitation-token": token } },
    );
    expect(response.status).toBe(403);
    expect(await count("household_invitations", "status = 'pending'")).toBe(1);
  });

  it("reports accountExists to anonymous visitors so the page can send them to sign in", async () => {
    const { token } = await seedInvitation("kid@example.com");
    await createTestUser({ email: "kid@example.com" });

    const lookup = await SELF.fetch(
      "http://localhost:8787/api/invitations/lookup",
      { headers: { "x-invitation-token": token } },
    );
    await expect(lookup.json()).resolves.toMatchObject({
      accountExists: true,
      viewer: null,
    });
  });
});
