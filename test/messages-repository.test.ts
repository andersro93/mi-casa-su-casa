import { describe, expect, it, vi } from "vitest";

import {
  insertMessage,
  insertQuarantineMessage,
} from "../src/server/db/repositories/messages";
import type { ParsedIncomingEmail } from "../src/server/db/types";

function createParsedEmail(
  overrides?: Partial<ParsedIncomingEmail>,
): ParsedIncomingEmail {
  return {
    envelopeFrom: "login@service.example",
    envelopeTo: "codes@example.com",
    householdSlug: "codes",
    fromHeader: "Service <login@service.example>",
    subject: "Your verification code",
    messageId: "<message-1@test>",
    dateHeader: "2026-05-10T12:00:00Z",
    textBody: "Your verification code is 123456",
    rawSize: 256,
    ...overrides,
  };
}

function createDb(runImpl: () => Promise<unknown>) {
  const run = vi.fn(runImpl);
  const all = vi.fn(async () => ({ results: [] }));
  const bind = vi.fn(() => ({ all, run }));
  const prepare = vi.fn(() => ({ all, bind, run }));

  return {
    db: {
      prepare,
      batch: vi.fn(async () => []),
    } as unknown as D1Database,
    prepare,
    all,
    bind,
    run,
  };
}

describe("messages repository inserts", () => {
  it("ignores duplicate inbox message ids", async () => {
    const db = createDb(async () => {
      throw new Error(
        "UNIQUE constraint failed: messages.household_id, messages.message_id",
      );
    });

    await expect(
      insertMessage(
        db.db,
        // The sender-controlled Date header must not influence received_at.
        createParsedEmail({ dateHeader: "2099-01-01T00:00:00Z" }),
        "household-1",
        "provider-1",
        {
          kind: "matched",
          householdId: "household-1",
          householdSlug: "codes",
          providerId: "provider-1",
          providerKey: "netflix",
          code: "123456",
          reason:
            "Sender matched a configured rule and a likely verification code was found.",
        },
        new Date("2026-05-10T12:00:00Z"),
      ),
    ).resolves.toMatchObject({
      receivedAt: "2026-05-10T12:00:00.000Z",
      deleteAfter: "2026-06-09T12:00:00.000Z",
    });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO messages"),
    );
    expect(db.run).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate quarantine message ids", async () => {
    const db = createDb(async () => {
      throw new Error(
        "UNIQUE constraint failed: quarantine_messages.household_id, quarantine_messages.message_id",
      );
    });

    await expect(
      insertQuarantineMessage(
        db.db,
        createParsedEmail({ dateHeader: "1999-01-01T00:00:00Z" }),
        "household-1",
        {
          kind: "quarantine",
          reason: "No sender rule matched the inbound email.",
          code: "123456",
        },
        new Date("2026-05-10T12:00:00Z"),
      ),
    ).resolves.toMatchObject({
      receivedAt: "2026-05-10T12:00:00.000Z",
      deleteAfter: "2026-06-09T12:00:00.000Z",
    });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO quarantine_messages"),
    );
    expect(db.run).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-unique database failures", async () => {
    const db = createDb(async () => {
      throw new Error("database unavailable");
    });

    await expect(
      insertMessage(db.db, createParsedEmail(), "household-1", "provider-1", {
        kind: "matched",
        householdId: "household-1",
        householdSlug: "codes",
        providerId: "provider-1",
        providerKey: "netflix",
        code: "123456",
        reason:
          "Sender matched a configured rule and a likely verification code was found.",
      }),
    ).rejects.toThrow("database unavailable");
  });
});
