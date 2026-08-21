import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import { createHousehold } from "@server/db/repositories/households";
import {
  insertMessage,
  insertQuarantineMessage,
  listMessagesForProvider,
  listQuarantineMessages,
  reviewQuarantineMessage,
} from "@server/db/repositories/messages";
import { createProvider } from "@server/db/repositories/provider-rules";
import type { ParsedIncomingEmail } from "@server/db/types";
import { describe, expect, it } from "vitest";

import { count, db, insertHousehold, testEnv } from "./helpers";

async function ownerSession() {
  const result = await provisioningAuthForEnv(testEnv()).api.signUpEmail({
    body: {
      email: "owner@example.com",
      name: "Owner",
      password: "averylongpassword123",
    },
    returnHeaders: true,
  });
  const cookie = result.headers
    .getSetCookie()
    .map((entry: string) => entry.split(";")[0])
    .join("; ");
  await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId: result.response.user.id,
  });
  return cookie;
}

function parsedEmail(messageId: string): ParsedIncomingEmail {
  return {
    envelopeFrom: "info@netflix.com",
    envelopeTo: "casa@example.com",
    householdSlug: "casa",
    fromHeader: "Netflix <info@netflix.com>",
    subject: "Code",
    messageId,
    dateHeader: null,
    textBody: "Your verification code is 123456",
    rawSize: 100,
  };
}

describe("API error handling", () => {
  it("returns JSON 409 for a duplicate sender rule instead of a text 500", async () => {
    const cookie = await ownerSession();
    const household = (await db
      .prepare("SELECT id FROM households WHERE slug = 'casa'")
      .first<{ id: string }>()) as { id: string };
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    const body = JSON.stringify({
      providerId: provider.id,
      matchType: "domain",
      matchValue: "netflix.com",
    });
    const post = () =>
      SELF.fetch("http://localhost:8787/api/admin/casa/provider-rules", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body,
      });

    expect((await post()).status).toBe(201);
    const duplicate = await post();
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers.get("content-type")).toMatch(/application\/json/);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already exists/),
    });
  });

  it("answers unknown API routes with JSON 404", async () => {
    const response = await SELF.fetch(
      "http://localhost:8787/api/does-not-exist",
      {
        method: "POST",
      },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });
});

describe("quarantine release", () => {
  it("is atomic and tolerates an already-classified copy of the same Message-ID", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    const matched = {
      kind: "matched" as const,
      householdId: household.id,
      householdSlug: "casa",
      providerId: provider.id,
      providerKey: "netflix",
      code: "123456",
      reason: "matched",
    };

    // Same Message-ID stored once as a classified message and once quarantined.
    await insertMessage(
      db,
      parsedEmail("<dup@test>"),
      household.id,
      provider.id,
      matched,
    );
    const quarantined = await insertQuarantineMessage(
      db,
      parsedEmail("<dup@test>"),
      household.id,
      {
        kind: "quarantine",
        householdId: household.id,
        reason: "no rule",
        code: null,
      },
    );

    const result = await reviewQuarantineMessage(
      db,
      household.id,
      quarantined.id,
      {
        action: "release",
        providerId: provider.id,
      },
    );

    expect(result?.releasedMessage).toMatchObject({ provider_key: "netflix" });
    expect(await count("messages")).toBe(1);
    expect((await listQuarantineMessages(db, household.id)).items).toHaveLength(
      0,
    );
    expect(
      (await listMessagesForProvider(db, household.id, "netflix")).items,
    ).toHaveLength(1);
  });
});
