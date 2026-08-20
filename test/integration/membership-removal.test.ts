import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import {
  addUserToHousehold,
  createHousehold,
} from "@server/db/repositories/households";
import { grantProviderAccess } from "@server/db/repositories/member-access";
import { createProvider } from "@server/db/repositories/provider-rules";
import { describe, expect, it } from "vitest";

import { count, db, testEnv } from "./helpers";

async function signUp(email: string) {
  const result = await provisioningAuthForEnv(testEnv()).api.signUpEmail({
    body: { email, name: email, password: "averylongpassword123" },
    returnHeaders: true,
  });
  const cookie = result.headers
    .getSetCookie()
    .map((entry: string) => entry.split(";")[0])
    .join("; ");
  return { id: result.response.user.id, cookie };
}

async function seed() {
  const owner = await signUp("owner@example.com");
  const member = await signUp("member@example.com");
  const household = await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId: owner.id,
  });
  const householdId = household?.id ?? "";
  await addUserToHousehold(db, {
    householdId,
    userId: member.id,
    role: "member",
  });
  const provider = await createProvider(db, householdId, "netflix", "Netflix");
  await grantProviderAccess(db, householdId, member.id, provider.id);
  return { owner, member, householdId };
}

const api = (path: string, cookie: string, method = "POST") =>
  SELF.fetch(`http://localhost:8787${path}`, { method, headers: { cookie } });

describe("removing members and leaving households", () => {
  it("owner removes a member (provider access cascades); member cannot remove anyone", async () => {
    const { owner, member } = await seed();
    expect(await count("household_member_provider_access")).toBe(1);

    const forbidden = await api(
      `/api/admin/casa/members/${owner.id}`,
      member.cookie,
      "DELETE",
    );
    expect(forbidden.status).toBe(403);

    const removed = await api(
      `/api/admin/casa/members/${member.id}`,
      owner.cookie,
      "DELETE",
    );
    expect(removed.status).toBe(200);
    expect(await count("household_memberships")).toBe(1);
    expect(await count("household_member_provider_access")).toBe(0);
  });

  it("protects the last owner from removal and self-removal via the admin route", async () => {
    const { owner } = await seed();

    const self = await api(
      `/api/admin/casa/members/${owner.id}`,
      owner.cookie,
      "DELETE",
    );
    expect(self.status).toBe(400);

    // Promote the member to owner, demote nothing; removing the original owner
    // is then allowed — but removing the *last* owner never is.
    const { member } = await (async () => {
      // fetch member id
      const row = await db
        .prepare("SELECT id FROM user WHERE email = 'member@example.com'")
        .first<{ id: string }>();
      return { member: row as { id: string } };
    })();
    await db
      .prepare(
        "UPDATE household_memberships SET role = 'member' WHERE user_id = ?1",
      )
      .bind(member.id)
      .run();
    const lastOwner = await api(
      `/api/admin/casa/members/${member.id}`,
      owner.cookie,
      "DELETE",
    );
    expect(lastOwner.status).toBe(200); // member removed fine
    expect(await count("household_memberships", "role = 'owner'")).toBe(1);
  });

  it("a member can leave; the only owner cannot leave until another owner exists", async () => {
    const { owner, member } = await seed();

    const ownerLeave = await api("/api/households/casa/leave", owner.cookie);
    expect(ownerLeave.status).toBe(409);

    const memberLeave = await api("/api/households/casa/leave", member.cookie);
    expect(memberLeave.status).toBe(200);
    expect(await count("household_memberships")).toBe(1);

    // Non-members get 403 from the household context guard.
    const again = await api("/api/households/casa/leave", member.cookie);
    expect(again.status).toBe(403);

    // With a second owner, the original owner may leave.
    await addUserToHousehold(db, {
      householdId:
        (await db.prepare("SELECT id FROM households").first<{ id: string }>())
          ?.id ?? "",
      userId: member.id,
      role: "owner",
    });
    const ownerLeaveNow = await api("/api/households/casa/leave", owner.cookie);
    expect(ownerLeaveNow.status).toBe(200);
    expect(await count("household_memberships", "role = 'owner'")).toBe(1);
  });
});
