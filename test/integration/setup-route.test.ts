import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { count } from "./helpers";

const setupPayload = {
  email: "owner@example.com",
  name: "Owner",
  password: "averylongpassword123",
  householdName: "Casa",
  householdSlug: "casa",
  setupSecret: "test-setup-secret",
};

async function postSetup(body: unknown) {
  return SELF.fetch("http://localhost:8787/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("first-run setup (end-to-end against D1)", () => {
  it("creates the owner, the household and the owner membership, then locks", async () => {
    const status = await SELF.fetch("http://localhost:8787/api/setup/status");
    expect(await status.json()).toMatchObject({
      needsSetup: true,
      status: "pending",
    });

    const response = await postSetup(setupPayload);
    expect(response.status).toBe(201);
    const payload = await response.json<{
      member: { email: string; role: string };
      household: { slug: string };
    }>();
    expect(payload.member).toMatchObject({
      email: "owner@example.com",
      role: "owner",
    });
    expect(payload.household).toMatchObject({ slug: "casa" });
    expect(response.headers.getSetCookie().join(";")).toMatch(/better-auth/);

    expect(await count("user")).toBe(1);
    expect(await count("households", "slug = ?1", "casa")).toBe(1);
    expect(await count("household_memberships", "role = 'owner'")).toBe(1);

    const locked = await SELF.fetch("http://localhost:8787/api/setup/status");
    expect(await locked.json()).toMatchObject({
      needsSetup: false,
      setupLocked: true,
    });

    const again = await postSetup(setupPayload);
    expect(again.status).toBe(409);
  });

  it("rejects a wrong setup secret or a non-owner email without creating anything", async () => {
    expect(
      (await postSetup({ ...setupPayload, setupSecret: "nope" })).status,
    ).toBe(403);
    expect(
      (await postSetup({ ...setupPayload, email: "someone-else@example.com" }))
        .status,
    ).toBe(403);
    expect(await count("user")).toBe(0);
    expect(await count("households")).toBe(0);
  });
});
