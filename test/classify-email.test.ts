import { describe, expect, it } from "vitest";

import type { ParsedIncomingEmail } from "../src/server/db/types";
import { classifyEmail } from "../src/server/domain/classify-email";

function createDbStub(
  match: { providerId: string; providerKey: string } | null,
): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: match ? [match] : [] }),
        first: async () => match,
      }),
    }),
  } as unknown as D1Database;
}

function createParsedEmail(
  overrides?: Partial<ParsedIncomingEmail>,
): ParsedIncomingEmail {
  return {
    envelopeFrom: "login@service.example",
    envelopeTo: "codes@example.com",
    fromHeader: "Service <login@service.example>",
    subject: "Your verification code",
    messageId: "<test-1@example.com>",
    dateHeader: new Date("2026-05-10T12:00:00Z").toISOString(),
    textBody: "Your verification code is 123456",
    rawSize: 123,
    ...overrides,
  };
}

describe("classifyEmail", () => {
  it("matches a configured provider and extracts the code", async () => {
    const result = await classifyEmail(
      createDbStub({ providerId: "provider-1", providerKey: "netflix" }),
      createParsedEmail(),
    );

    expect(result).toEqual({
      kind: "matched",
      providerId: "provider-1",
      providerKey: "netflix",
      code: "123456",
      reason:
        "Sender matched a configured rule and a likely verification code was found.",
    });
  });

  it("quarantines when there is no sender rule match", async () => {
    const result = await classifyEmail(createDbStub(null), createParsedEmail());

    expect(result).toEqual({
      kind: "quarantine",
      reason: "No sender rule matched the inbound email.",
      code: "123456",
    });
  });
});
