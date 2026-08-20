import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import { listAuditEvents } from "@server/db/repositories/audit";
import {
  addUserToHousehold,
  createHousehold,
} from "@server/db/repositories/households";
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

function call(path: string, cookie: string, method = "GET", body?: unknown) {
  return SELF.fetch(`http://localhost:8787${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("audit log", () => {
  it("records owner actions with actor, household and target, and lists them to owners only", async () => {
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

    const provider = await call(
      "/api/admin/casa/providers",
      owner.cookie,
      "POST",
      {
        providerKey: "netflix",
        displayName: "Netflix",
      },
    );
    expect(provider.status).toBe(201);
    const { provider: created } = await provider.json<{
      provider: { id: string };
    }>();

    expect(
      (
        await call("/api/admin/casa/provider-rules", owner.cookie, "POST", {
          providerId: created.id,
          matchType: "domain",
          matchValue: "netflix.com",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          `/api/admin/casa/members/${member.id}/provider-access`,
          owner.cookie,
          "POST",
          {
            providerKey: "netflix",
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          `/api/admin/casa/members/${member.id}/role`,
          owner.cookie,
          "PATCH",
          {
            role: "owner",
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/admin/casa/settings", owner.cookie, "PATCH", {
          displayName: "Casa 2",
        })
      ).status,
    ).toBe(200);

    const events = await listAuditEvents(db, householdId);
    expect(events.map((e) => e.action).sort()).toEqual(
      [
        "household.settings_updated",
        "member.provider_access_granted",
        "member.role_changed",
        "provider.created",
        "sender_rule.created",
      ].sort(),
    );
    for (const event of events) {
      expect(event.actorUserId).toBe(owner.id);
      expect(event.householdId).toBe(householdId);
    }
    expect(events.find((e) => e.action === "provider.created")).toMatchObject({
      targetId: created.id,
      details: { providerKey: "netflix" },
    });

    const listed = await call("/api/admin/casa/audit", owner.cookie);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ action: "provider.created" }),
      ]),
    });

    // The promoted member is now an owner too and may read the log; demote and check denial.
    await db
      .prepare(
        "UPDATE household_memberships SET role = 'member' WHERE user_id = ?1",
      )
      .bind(member.id)
      .run();
    expect((await call("/api/admin/casa/audit", member.cookie)).status).toBe(
      403,
    );
  });

  it("records session revocation, household creation and leaving", async () => {
    const user = await signUp("solo@example.com");
    expect(
      (
        await call("/api/households", user.cookie, "POST", {
          slug: "solo",
          displayName: "Solo",
        })
      ).status,
    ).toBe(201);
    expect(
      (await call("/api/settings/sessions/others", user.cookie, "DELETE"))
        .status,
    ).toBe(200);

    const actions = (
      await db
        .prepare("SELECT action FROM audit_events ORDER BY created_at")
        .all<{ action: string }>()
    ).results.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(["household.created", "session.revoked_others"]),
    );
    expect(await count("audit_events")).toBeGreaterThanOrEqual(2);
  });
});
