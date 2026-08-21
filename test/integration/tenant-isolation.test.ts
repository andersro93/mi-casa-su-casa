import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import { createHousehold } from "@server/db/repositories/households";
import {
  createHouseholdInvitation,
  getInvitationById,
  getProvidersByIds,
} from "@server/db/repositories/invitations";
import { grantProviderAccess } from "@server/db/repositories/member-access";
import { createProvider } from "@server/db/repositories/provider-rules";
import { forHousehold } from "@server/db/scoped";
import { describe, expect, it } from "vitest";

import { count, db, testEnv } from "./helpers";

async function owner(email: string, slug: string) {
  const result = await provisioningAuthForEnv(testEnv()).api.signUpEmail({
    body: { email, name: email, password: "averylongpassword123" },
    returnHeaders: true,
  });
  const cookie = result.headers
    .getSetCookie()
    .map((entry: string) => entry.split(";")[0])
    .join("; ");
  const household = await createHousehold(db, {
    slug,
    displayName: slug,
    ownerUserId: result.response.user.id,
  });
  return {
    id: result.response.user.id,
    cookie,
    householdId: household?.id ?? "",
  };
}

describe("tenant isolation by construction", () => {
  it("scoped repository functions never return another household's rows", async () => {
    const a = await owner("a@example.com", "casa-a");
    const b = await owner("b@example.com", "casa-b");
    const providerA = await createProvider(
      db,
      a.householdId,
      "netflix",
      "Netflix",
    );
    const invitationA = await createHouseholdInvitation(db, {
      householdId: a.householdId,
      email: "kid@example.com",
      name: "Kid",
      role: "member",
      tokenHash: "h1",
      invitedByUserId: a.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      providerIds: [providerA.id],
    });

    expect(
      await getInvitationById(db, a.householdId, invitationA),
    ).not.toBeNull();
    expect(await getInvitationById(db, b.householdId, invitationA)).toBeNull();
    expect(await getProvidersByIds(db, b.householdId, [providerA.id])).toEqual(
      [],
    );

    // Granting access to a provider from another household is a no-op.
    await grantProviderAccess(db, b.householdId, b.id, providerA.id);
    expect(await count("household_member_provider_access")).toBe(0);

    const repoB = forHousehold(db, b.householdId);
    expect(await repoB.invitations.list()).toEqual([]);
    expect(await repoB.providers.byKey("netflix")).toBeNull();
    expect((await repoB.messages.listForProvider("netflix")).items).toEqual([]);
  });

  it("owner-only list endpoints are 403 for another household's owner", async () => {
    const a = await owner("a@example.com", "casa-a");
    await owner("b@example.com", "casa-b");

    for (const path of [
      "/api/admin/casa-b/invitations",
      "/api/admin/casa-b/members",
      "/api/admin/casa-b/providers",
      "/api/admin/casa-b/audit",
      "/api/admin/casa-b/settings",
      "/api/inbox/casa-b/quarantine",
      "/api/inbox/casa-b/providers",
    ]) {
      const response = await SELF.fetch(`http://localhost:8787${path}`, {
        headers: { cookie: a.cookie },
      });
      expect(response.status, path).toBe(403);
    }
  });
});
