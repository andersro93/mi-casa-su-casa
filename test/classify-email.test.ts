import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ParsedIncomingEmail } from "../src/server/db/types";

const repoState = vi.hoisted(() => ({
  household: null as { id: string; slug: string; displayName: string } | null,
  match: null as {
    householdId: string;
    householdSlug: string;
    providerId: string;
    providerKey: string;
  } | null,
}));

vi.mock("../src/server/db/repositories/households", () => ({
  getHouseholdBySlug: vi.fn(async () => repoState.household),
}));

vi.mock("../src/server/db/repositories/provider-rules", () => ({
  findProviderMatch: vi.fn(async () => repoState.match),
}));

const { classifyEmail } = await import("../src/server/domain/classify-email");

function createParsedEmail(
  overrides?: Partial<ParsedIncomingEmail>,
): ParsedIncomingEmail {
  return {
    envelopeFrom: "login@service.example",
    envelopeTo: "casa@example.com",
    householdSlug: "casa",
    fromHeader: "Service <login@service.example>",
    subject: "Your verification code",
    messageId: "<test-1@example.com>",
    dateHeader: new Date("2026-05-10T12:00:00Z").toISOString(),
    textBody: "Your verification code is 123456",
    rawSize: 123,
    ...overrides,
  };
}

const db = {} as D1Database;

describe("classifyEmail", () => {
  beforeEach(() => {
    repoState.household = {
      id: "household-1",
      slug: "casa",
      displayName: "Casa",
    };
    repoState.match = null;
  });

  it("matches a configured provider and extracts the code", async () => {
    repoState.match = {
      householdId: "household-1",
      householdSlug: "casa",
      providerId: "provider-1",
      providerKey: "netflix",
    };

    await expect(classifyEmail(db, createParsedEmail())).resolves.toEqual({
      kind: "matched",
      householdId: "household-1",
      householdSlug: "casa",
      providerId: "provider-1",
      providerKey: "netflix",
      code: "123456",
      reason:
        "Sender matched a configured rule and a likely verification code was found.",
    });
  });

  it("quarantines within the household when there is no sender rule match", async () => {
    await expect(classifyEmail(db, createParsedEmail())).resolves.toEqual({
      kind: "quarantine",
      householdId: "household-1",
      reason:
        "No sender rule matched the inbound email within the addressed household.",
      code: "123456",
    });
  });

  it("reports an unknown household (no householdId) when the slug does not resolve", async () => {
    repoState.household = null;

    await expect(classifyEmail(db, createParsedEmail())).resolves.toMatchObject(
      {
        kind: "quarantine",
        householdId: null,
      },
    );
  });

  it("reports an unknown household when the recipient has no usable slug", async () => {
    await expect(
      classifyEmail(db, createParsedEmail({ householdSlug: null })),
    ).resolves.toMatchObject({ kind: "quarantine", householdId: null });
  });
});
