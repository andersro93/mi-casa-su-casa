import {
  insertMessage,
  insertQuarantineMessage,
  listMessagesForProvider,
  listQuarantineMessages,
  purgeExpired,
} from "@server/db/repositories/messages";
import { createProvider } from "@server/db/repositories/provider-rules";
import type { ParsedIncomingEmail } from "@server/db/types";
import { describe, expect, it } from "vitest";

import { count, db, insertHousehold } from "./helpers";

function parsedEmail(
  overrides: Partial<ParsedIncomingEmail> = {},
): ParsedIncomingEmail {
  return {
    envelopeFrom: "login@service.example",
    envelopeTo: "casa@example.com",
    householdSlug: "casa",
    fromHeader: "Service <login@service.example>",
    subject: "Your verification code",
    messageId: "<message-1@test>",
    dateHeader: "2026-05-10T12:00:00Z",
    textBody: "Your verification code is 123456",
    rawSize: 256,
    ...overrides,
  };
}

describe("messages repository (D1)", () => {
  it("stores a matched message and lists it for the provider", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );

    await insertMessage(db, parsedEmail(), household.id, provider.id, {
      kind: "matched",
      householdId: household.id,
      householdSlug: "casa",
      providerId: provider.id,
      providerKey: "netflix",
      code: "123456",
      reason: "matched",
    });

    const rows = await listMessagesForProvider(db, household.id, "netflix");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      household_slug: "casa",
      provider_key: "netflix",
      extracted_code: "123456",
      status: "new",
    });
  });

  it("ignores a redelivered message with the same Message-ID in the same household, but stores it for another household", async () => {
    const casa = await insertHousehold({ slug: "casa" });
    const otra = await insertHousehold({ slug: "otra" });
    const casaProvider = await createProvider(
      db,
      casa.id,
      "netflix",
      "Netflix",
    );
    const otraProvider = await createProvider(
      db,
      otra.id,
      "netflix",
      "Netflix",
    );
    const matched = (householdId: string, providerId: string) => ({
      kind: "matched" as const,
      householdId,
      householdSlug: "x",
      providerId,
      providerKey: "netflix",
      code: "123456",
      reason: "matched",
    });

    await insertMessage(
      db,
      parsedEmail(),
      casa.id,
      casaProvider.id,
      matched(casa.id, casaProvider.id),
    );
    await insertMessage(
      db,
      parsedEmail(),
      casa.id,
      casaProvider.id,
      matched(casa.id, casaProvider.id),
    );
    await insertMessage(
      db,
      parsedEmail(),
      otra.id,
      otraProvider.id,
      matched(otra.id, otraProvider.id),
    );

    expect(await count("messages", "household_id = ?1", casa.id)).toBe(1);
    expect(await count("messages", "household_id = ?1", otra.id)).toBe(1);
  });

  it("quarantines unmatched mail and purges expired rows", async () => {
    const household = await insertHousehold({ slug: "casa" });

    await insertQuarantineMessage(
      db,
      parsedEmail({ messageId: "<q-1@test>" }),
      household.id,
      {
        kind: "quarantine",
        householdId: household.id,
        reason: "no rule",
        code: null,
      },
      new Date("2020-01-01T00:00:00Z"),
    );
    await insertQuarantineMessage(
      db,
      parsedEmail({ messageId: "<q-2@test>" }),
      household.id,
      {
        kind: "quarantine",
        householdId: household.id,
        reason: "no rule",
        code: null,
      },
    );

    expect(await listQuarantineMessages(db, household.id)).toHaveLength(2);

    await purgeExpired(db, new Date().toISOString());

    const remaining = await listQuarantineMessages(db, household.id);
    expect(remaining).toHaveLength(1);
  });
});

describe("received_at is server time, not the Date: header (D1)", () => {
  it("keeps a forged far-future Date header from escaping retention or topping the inbox", async () => {
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
    const t0 = new Date("2026-05-10T12:00:00Z");

    await insertMessage(
      db,
      parsedEmail({
        messageId: "<forged@test>",
        dateHeader: "2099-01-01T00:00:00Z",
      }),
      household.id,
      provider.id,
      matched,
      t0,
    );
    await insertMessage(
      db,
      parsedEmail({
        messageId: "<genuine@test>",
        dateHeader: "2026-05-10T12:05:00Z",
      }),
      household.id,
      provider.id,
      matched,
      new Date("2026-05-10T12:05:00Z"),
    );

    const rows = await listMessagesForProvider(db, household.id, "netflix");
    expect(rows.map((row) => row.received_at)).toEqual([
      "2026-05-10T12:05:00.000Z",
      "2026-05-10T12:00:00.000Z",
    ]);

    // 31 days after t0 everything is purged, whatever the header claimed.
    await purgeExpired(db, new Date("2026-06-10T12:00:00Z").toISOString());
    expect(await count("messages")).toBe(0);

    // The header value is still available for display.
    const stored = await db
      .prepare("SELECT date_header FROM quarantine_messages")
      .all();
    expect(stored.results).toEqual([]);
  });
});
