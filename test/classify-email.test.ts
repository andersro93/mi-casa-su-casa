import { describe, expect, it } from "vitest";

import type { ParsedIncomingEmail } from "../src/server/db/types";
import { classifyEmail } from "../src/server/domain/classify-email";

function createDbStub(
  match:
    | {
        householdId: string;
        householdSlug: string;
        providerId: string;
        providerKey: string;
      }
    | null,
): D1Database {
  let call = 0;

  const nextResult = () => {
    call += 1;

    if (call === 1) {
      return { id: "household-1", slug: "codes", displayName: "Codes" };
    }

    return match;
  };

  return {
    prepare: () => ({
      bind: () => ({
        all: async () => {
          const result = nextResult();
          return { results: result ? [result] : [] };
        },
        first: async () => nextResult(),
        raw: async () => {
          const result = nextResult();
          return result ? [result] : [];
        },
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
    householdSlug: "codes",
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
      createDbStub({
        householdId: "household-1",
        householdSlug: "codes",
        providerId: "provider-1",
        providerKey: "netflix",
      }),
      createParsedEmail(),
    );

    expect(result).toEqual({
      kind: "matched",
      householdId: "household-1",
      householdSlug: "codes",
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
      reason:
        "No sender rule matched the inbound email within the addressed household.",
      code: "123456",
    });
  });
});
