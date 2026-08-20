import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import {
  addUserToHousehold,
  createHousehold,
} from "@server/db/repositories/households";
import { completeInstallationSetup } from "@server/db/repositories/installation-state";
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

async function create(cookie: string, slug: string) {
  return SELF.fetch("http://localhost:8787/api/households", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ slug, displayName: `Household ${slug}` }),
  });
}

describe("household creation policy", () => {
  it("lets the installation owner create more households but not an invited member", async () => {
    const owner = await signUp("owner@example.com");
    const member = await signUp("member@example.com");
    const first = await createHousehold(db, {
      slug: "casa",
      displayName: "Casa",
      ownerUserId: owner.id,
    });
    await completeInstallationSetup(db, owner.id, "owner@example.com");
    await addUserToHousehold(db, {
      householdId: first?.id ?? "",
      userId: member.id,
      role: "member",
    });

    const ownerCreate = await create(owner.cookie, "cabin");
    expect(ownerCreate.status).toBe(201);
    await expect(ownerCreate.json()).resolves.toMatchObject({
      household: { slug: "cabin", role: "owner" },
    });

    const memberCreate = await create(member.cookie, "mine");
    expect(memberCreate.status).toBe(403);
    expect(await count("households")).toBe(2);
  });

  it("lets a user with no household create their first one", async () => {
    const user = await signUp("solo@example.com");
    expect((await create(user.cookie, "solo")).status).toBe(201);
    expect((await create(user.cookie, "solo-two")).status).toBe(403);
  });

  it("rejects reserved or malformed slugs at creation and at setup", async () => {
    const user = await signUp("solo@example.com");
    for (const slug of ["members", "settings", "api", "-bad", "x"]) {
      const response = await create(user.cookie, slug);
      expect(response.status, slug).toBe(400);
    }
    expect(await count("households")).toBe(0);

    const setup = await SELF.fetch("http://localhost:8787/api/setup/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        name: "Owner",
        password: "averylongpassword123",
        householdName: "X",
        householdSlug: "invite",
        setupSecret: "test-setup-secret",
      }),
    });
    expect(setup.status).toBe(400);
  });
});
