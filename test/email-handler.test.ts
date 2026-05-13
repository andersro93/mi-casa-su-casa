import { beforeEach, describe, expect, it, vi } from "vitest";

const parseState = vi.hoisted(() => ({
  result: {
    envelopeFrom: "login@service.example",
    envelopeTo: "codes@example.com",
    householdSlug: "codes",
    fromHeader: "Service <login@service.example>",
    subject: "Verification code",
    messageId: "<message-1@test>",
    dateHeader: "2026-05-10T12:00:00.000Z",
    textBody: "Your verification code is 123456",
    rawSize: 128,
  },
}));

const classifyState = vi.hoisted(() => ({
  result: {
    kind: "matched",
    householdId: "household-1",
    householdSlug: "codes",
    providerId: "provider-1",
    providerKey: "netflix",
    code: "123456",
    reason:
      "Sender matched a configured rule and a likely verification code was found.",
  } as
    | {
        kind: "matched";
        householdId: string;
        householdSlug: string;
        providerId: string;
        providerKey: string;
        code: string | null;
        reason: string;
      }
    | {
        kind: "quarantine";
        reason: string;
        code: string | null;
      },
}));

const messageRepoState = vi.hoisted(() => ({
  insertMessage: vi.fn(),
  insertQuarantineMessage: vi.fn(),
}));

const householdRepoState = vi.hoisted(() => ({
  getHouseholdBySlug: vi.fn(),
}));

vi.mock("../src/server/email/parse", () => ({
  parseIncomingEmail: vi.fn(async () => parseState.result),
}));

vi.mock("../src/server/domain/classify-email", () => ({
  classifyEmail: vi.fn(async () => classifyState.result),
}));

vi.mock("../src/server/db/repositories/messages", () => ({
  insertMessage: messageRepoState.insertMessage,
  insertQuarantineMessage: messageRepoState.insertQuarantineMessage,
}));

vi.mock("../src/server/db/repositories/households", () => ({
  getHouseholdBySlug: householdRepoState.getHouseholdBySlug,
}));

const { handleIncomingEmail } = await import("../src/server/email/handler");

function createMessage(): ForwardableEmailMessage {
  return {
    from: "login@service.example",
    to: "codes@example.com",
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("raw"));
        controller.close();
      },
    }),
    rawSize: 128,
    headers: new Headers(),
    setReject() {},
    forward() {
      return Promise.resolve();
    },
    reply() {
      return Promise.resolve();
    },
  } as unknown as ForwardableEmailMessage;
}

function createAppContext(): import("../src/server/runtime/context").AppContext {
  return {
    env: {
      DB: {} as D1Database,
    } as Env,
    executionContext: {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
  };
}

describe("handleIncomingEmail", () => {
  beforeEach(() => {
    parseState.result = {
      envelopeFrom: "login@service.example",
      envelopeTo: "codes@example.com",
      householdSlug: "codes",
      fromHeader: "Service <login@service.example>",
      subject: "Verification code",
      messageId: "<message-1@test>",
      dateHeader: "2026-05-10T12:00:00.000Z",
      textBody: "Your verification code is 123456",
      rawSize: 128,
    };
    classifyState.result = {
      kind: "matched",
      householdId: "household-1",
      householdSlug: "codes",
      providerId: "provider-1",
      providerKey: "netflix",
      code: "123456",
      reason:
        "Sender matched a configured rule and a likely verification code was found.",
    };
    messageRepoState.insertMessage.mockReset();
    messageRepoState.insertQuarantineMessage.mockReset();
    householdRepoState.getHouseholdBySlug.mockReset();
    householdRepoState.getHouseholdBySlug.mockResolvedValue({
      id: "household-1",
      slug: "codes",
      displayName: "Codes",
    });
  });

  it("persists matched emails to messages", async () => {
    await handleIncomingEmail(createMessage(), createAppContext());

    expect(messageRepoState.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      parseState.result,
      "household-1",
      "provider-1",
      classifyState.result,
    );
    expect(messageRepoState.insertQuarantineMessage).not.toHaveBeenCalled();
  });

  it("routes unmatched senders into quarantine within the resolved household", async () => {
    classifyState.result = {
      kind: "quarantine",
      reason:
        "No sender rule matched the inbound email within the addressed household.",
      code: "654321",
    };
    parseState.result = {
      ...parseState.result,
      envelopeFrom: "unknown@example.net",
      fromHeader: "Unknown <unknown@example.net>",
      textBody: "Use 654321 to continue.",
    };

    await handleIncomingEmail(createMessage(), createAppContext());

    expect(householdRepoState.getHouseholdBySlug).toHaveBeenCalledWith(
      expect.anything(),
      "codes",
    );
    expect(messageRepoState.insertQuarantineMessage).toHaveBeenCalledWith(
      expect.anything(),
      parseState.result,
      "household-1",
      classifyState.result,
    );
    expect(messageRepoState.insertMessage).not.toHaveBeenCalled();
  });

  it("drops quarantined emails when no household can be resolved", async () => {
    classifyState.result = {
      kind: "quarantine",
      reason: "No household matched the inbound recipient address.",
      code: "654321",
    };
    householdRepoState.getHouseholdBySlug.mockResolvedValue(null);

    await handleIncomingEmail(createMessage(), createAppContext());

    expect(messageRepoState.insertQuarantineMessage).not.toHaveBeenCalled();
    expect(messageRepoState.insertMessage).not.toHaveBeenCalled();
  });
});
