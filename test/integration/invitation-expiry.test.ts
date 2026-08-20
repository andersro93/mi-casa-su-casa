import { SELF } from "cloudflare:test";
import { createHousehold } from "@server/db/repositories/households";
import {
  createHouseholdInvitation,
  getInvitationByTokenHash,
  isInvitationExpired,
  refreshExpiredInvitations,
} from "@server/db/repositories/invitations";
import { hashInvitationToken } from "@server/security/tokens";
import { describe, expect, it } from "vitest";

import { count, createTestUser, db } from "./helpers";

async function seed(expiresAt: Date, token = "tok") {
  const owner = await createTestUser({ email: "owner@example.com" });
  const household = await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId: owner.id,
  });
  await createHouseholdInvitation(db, {
    householdId: household?.id ?? "",
    email: "kid@example.com",
    name: "Kid",
    role: "member",
    tokenHash: await hashInvitationToken(token),
    invitedByUserId: owner.id,
    expiresAt: expiresAt.toISOString(),
    providerIds: [],
  });
  return token;
}

describe("invitation expiry", () => {
  it("treats an invitation that expired earlier today as expired (not tomorrow)", async () => {
    // The old comparison against CURRENT_TIMESTAMP kept same-day ISO values
    // 'pending' until the next calendar day.
    const now = new Date("2026-08-20T19:00:00.000Z");
    const token = await seed(new Date("2026-08-20T10:00:00.000Z"));

    const invitation = await getInvitationByTokenHash(
      db,
      await hashInvitationToken(token),
    );
    expect(invitation && isInvitationExpired(invitation, now)).toBe(true);

    await refreshExpiredInvitations(db, now);
    expect(await count("household_invitations", "status = 'expired'")).toBe(1);
  });

  it("keeps a future invitation pending", async () => {
    const now = new Date("2026-08-20T19:00:00.000Z");
    const token = await seed(new Date("2026-08-21T10:00:00.000Z"));

    await refreshExpiredInvitations(db, now);
    const invitation = await getInvitationByTokenHash(
      db,
      await hashInvitationToken(token),
    );
    expect(invitation?.status).toBe("pending");
    expect(invitation && isInvitationExpired(invitation, now)).toBe(false);
  });

  it("refuses to show or accept an expired invitation over the API", async () => {
    const token = await seed(new Date(Date.now() - 60_000));

    const lookup = await SELF.fetch(
      `http://localhost:8787/api/invitations/${token}`,
    );
    expect([404, 410]).toContain(lookup.status);

    const accept = await SELF.fetch(
      `http://localhost:8787/api/invitations/${token}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Kid", password: "averylongpassword123" }),
      },
    );
    expect([404, 410]).toContain(accept.status);
    expect(await count("user", "email = 'kid@example.com'")).toBe(0);
  });
});
