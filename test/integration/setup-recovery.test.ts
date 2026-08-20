import { SELF } from "cloudflare:test";
import { createHousehold } from "@server/db/repositories/households";
import {
  beginInstallationSetup,
  getInstallationState,
} from "@server/db/repositories/installation-state";
import { describe, expect, it } from "vitest";

import { count, createTestUser, db, insertHousehold } from "./helpers";

const setupPayload = {
  email: "owner@example.com",
  name: "Owner",
  password: "averylongpassword123",
  householdName: "Casa",
  householdSlug: "casa",
  setupSecret: "test-setup-secret",
};

async function postSetup(body: unknown = setupPayload) {
  return SELF.fetch("http://localhost:8787/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("first-run setup recovery", () => {
  it("recovers when a previous attempt left an orphan owner user behind", async () => {
    // Simulates: sign-up succeeded, household creation failed, isolate died.
    await createTestUser({ email: "owner@example.com" });
    expect(await count("user")).toBe(1);

    const response = await postSetup();

    expect(response.status).toBe(201);
    expect(await count("user")).toBe(1);
    expect(await count("household_memberships", "role = 'owner'")).toBe(1);
    expect((await getInstallationState(db)).status).toBe("complete");
  });

  it("finishes the installation when the owner already owns a household from an interrupted attempt", async () => {
    const owner = await createTestUser({ email: "owner@example.com" });
    await createHousehold(db, {
      slug: "casa",
      displayName: "Casa",
      ownerUserId: owner.id,
    });

    const response = await postSetup();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already/i),
    });
    const state = await getInstallationState(db);
    expect(state.status).toBe("complete");
    expect(state.owner_user_id).toBe(owner.id);
  });

  it("reclaims a stale in_progress claim but respects a fresh one", async () => {
    expect(await beginInstallationSetup(db)).toBe(true);
    // A second concurrent attempt must not win the claim.
    expect(await beginInstallationSetup(db)).toBe(false);
    expect((await postSetup()).status).toBe(409);

    // Make the claim stale (older than the recovery window) and retry.
    await db
      .prepare(
        "UPDATE app_installation SET updated_at = datetime('now', '-30 minutes') WHERE id = 1",
      )
      .run();
    expect((await postSetup()).status).toBe(201);
  });

  it("rolls back the created owner user when household creation fails", async () => {
    // Pre-existing household with the requested slug makes createHousehold throw.
    await insertHousehold({ slug: "casa" });

    const response = await postSetup();

    expect(response.status).toBe(409);
    expect(await count("user")).toBe(0);
    expect((await getInstallationState(db)).status).toBe("pending");

    // A corrected retry succeeds.
    expect(
      (await postSetup({ ...setupPayload, householdSlug: "otra" })).status,
    ).toBe(201);
  });
});
