import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import { createHousehold } from "@server/db/repositories/households";
import {
  listMessagesForProvider,
  listQuarantineMessages,
  normalizePageOptions,
} from "@server/db/repositories/messages";
import { createProvider } from "@server/db/repositories/provider-rules";
import { describe, expect, it } from "vitest";

import { db, testEnv } from "./helpers";

async function ownerWithHousehold() {
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
  const household = await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId: result.response.user.id,
  });
  return { cookie, householdId: household?.id ?? "" };
}

async function seedMessages(
  householdId: string,
  providerId: string,
  n: number,
) {
  const statements = [];
  for (let i = 0; i < n; i += 1) {
    const receivedAt = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    statements.push(
      db
        .prepare(
          `INSERT INTO messages (id, household_id, message_id, provider_id, envelope_from, envelope_to,
             text_body, classification_reason, raw_size, received_at, delete_after)
           VALUES (?1, ?2, ?3, ?4, 'a@b.c', 'casa@x.y', 'body', 'r', 1, ?5, '2099-01-01T00:00:00.000Z')`,
        )
        .bind(`m-${i}`, householdId, `<m-${i}@t>`, providerId, receivedAt),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO quarantine_messages (id, household_id, message_id, envelope_from, envelope_to,
             text_body, quarantine_reason, raw_size, received_at, delete_after)
           VALUES (?1, ?2, ?3, 'a@b.c', 'casa@x.y', 'body', 'r', 1, ?4, '2099-01-01T00:00:00.000Z')`,
        )
        .bind(`q-${i}`, householdId, `<q-${i}@t>`, receivedAt),
    );
  }
  for (let i = 0; i < statements.length; i += 100) {
    await db.batch(statements.slice(i, i + 100));
  }
}

describe("list pagination", () => {
  it("normalises page options", () => {
    expect(normalizePageOptions()).toEqual({ limit: 50, before: null });
    expect(normalizePageOptions({ limit: 0 })).toEqual({
      limit: 1,
      before: null,
    });
    expect(normalizePageOptions({ limit: 9999 })).toEqual({
      limit: 200,
      before: null,
    });
    expect(
      normalizePageOptions({ limit: Number.NaN, before: "garbage" }),
    ).toEqual({
      limit: 50,
      before: null,
    });
    expect(
      normalizePageOptions({ before: "2026-01-01T00:10:00Z" }).before,
    ).toBe("2026-01-01T00:10:00.000Z");
  });

  it("pages provider messages and quarantine newest-first with a keyset cursor", async () => {
    const { cookie, householdId } = await ownerWithHousehold();
    const provider = await createProvider(
      db,
      householdId,
      "netflix",
      "Netflix",
    );
    await seedMessages(householdId, provider.id, 60);

    const first = await listMessagesForProvider(db, householdId, "netflix", {
      limit: 50,
    });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.id).toBe("m-59");
    expect(first.nextBefore).toBe(first.items[49]?.received_at ?? null);

    const second = await listMessagesForProvider(db, householdId, "netflix", {
      limit: 50,
      before: first.nextBefore,
    });
    expect(second.items).toHaveLength(10);
    expect(second.items.at(-1)?.id).toBe("m-0");
    expect(second.nextBefore).toBeNull();

    const quarantine = await listQuarantineMessages(db, householdId, {
      limit: 25,
    });
    expect(quarantine.items).toHaveLength(25);
    expect(quarantine.nextBefore).not.toBeNull();

    // Over HTTP: defaults, page info, and the cursor round-trip.
    const page1 = await SELF.fetch(
      "http://localhost:8787/api/inbox/casa/providers/netflix",
      { headers: { cookie } },
    );
    const body1 = await page1.json<{
      messages: unknown[];
      page: { limit: number; nextBefore: string | null };
    }>();
    expect(body1.messages).toHaveLength(50);
    expect(body1.page).toMatchObject({ limit: 50 });
    expect(body1.page.nextBefore).toBeTruthy();

    const page2 = await SELF.fetch(
      `http://localhost:8787/api/inbox/casa/providers/netflix?limit=50&before=${encodeURIComponent(body1.page.nextBefore as string)}`,
      { headers: { cookie } },
    );
    const body2 = await page2.json<{
      messages: unknown[];
      page: { nextBefore: string | null };
    }>();
    expect(body2.messages).toHaveLength(10);
    expect(body2.page.nextBefore).toBeNull();

    const q = await SELF.fetch(
      "http://localhost:8787/api/inbox/casa/quarantine?limit=200",
      {
        headers: { cookie },
      },
    );
    const qBody = await q.json<{
      messages: unknown[];
      page: { nextBefore: string | null };
    }>();
    expect(qBody.messages).toHaveLength(60);
    expect(qBody.page.nextBefore).toBeNull();
  });
});
