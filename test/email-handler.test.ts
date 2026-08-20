import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClassificationResult,
  ParsedIncomingEmail,
} from "../src/server/db/types";

const parseState = vi.hoisted(() => ({
  result: null as unknown as ParsedIncomingEmail,
  error: null as Error | null,
}));

const classifyState = vi.hoisted(() => ({
  result: null as unknown as ClassificationResult,
}));

const messageRepoState = vi.hoisted(() => ({
  insertMessage: vi.fn(),
  insertQuarantineMessage: vi.fn(),
  countUnreviewedQuarantine: vi.fn(),
}));

vi.mock("../src/server/email/parse", () => ({
  MAX_TEXT_BODY_CHARS: 65536,
  parseIncomingEmail: vi.fn(async () => {
    if (parseState.error) throw parseState.error;
    return parseState.result;
  }),
}));

vi.mock("../src/server/domain/classify-email", () => ({
  classifyEmail: vi.fn(async () => classifyState.result),
}));

vi.mock("../src/server/db/repositories/messages", () => ({
  insertMessage: messageRepoState.insertMessage,
  insertQuarantineMessage: messageRepoState.insertQuarantineMessage,
  countUnreviewedQuarantine: messageRepoState.countUnreviewedQuarantine,
}));

const {
  handleIncomingEmail,
  MAX_RAW_MESSAGE_BYTES,
  MAX_UNREVIEWED_QUARANTINE,
} = await import("../src/server/email/handler");

function createMessage(overrides: Partial<{ rawSize: number }> = {}) {
  const setReject = vi.fn();
  const message = {
    from: "login@service.example",
    to: "casa@example.com",
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("raw"));
        controller.close();
      },
    }),
    rawSize: overrides.rawSize ?? 128,
    headers: new Headers(),
    setReject,
    forward() {
      return Promise.resolve();
    },
    reply() {
      return Promise.resolve();
    },
  } as unknown as ForwardableEmailMessage;
  return { message, setReject };
}

function createAppContext(): import("../src/server/runtime/context").AppContext {
  return {
    env: { DB: {} as D1Database } as Env,
    executionContext: {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
  };
}

const matched: ClassificationResult = {
  kind: "matched",
  householdId: "household-1",
  householdSlug: "casa",
  providerId: "provider-1",
  providerKey: "netflix",
  code: "123456",
  reason:
    "Sender matched a configured rule and a likely verification code was found.",
};

describe("handleIncomingEmail", () => {
  type Spy = { mock: { calls: unknown[][] } };
  let logSpy: Spy;
  let errorSpy: Spy;

  beforeEach(() => {
    parseState.error = null;
    parseState.result = {
      envelopeFrom: "login@service.example",
      envelopeTo: "casa@example.com",
      householdSlug: "casa",
      fromHeader: "Service <login@service.example>",
      subject: "Verification code",
      messageId: "<message-1@test>",
      dateHeader: "2026-05-10T12:00:00.000Z",
      textBody: "Your verification code is 123456",
      rawSize: 128,
    };
    classifyState.result = matched;
    messageRepoState.insertMessage.mockReset();
    messageRepoState.insertQuarantineMessage.mockReset();
    messageRepoState.countUnreviewedQuarantine.mockReset();
    messageRepoState.countUnreviewedQuarantine.mockResolvedValue(0);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function events(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls.map(
      (call: unknown[]) =>
        JSON.parse(String(call[0])) as Record<string, unknown> & {
          event: string;
        },
    );
  }

  it("persists matched emails and logs a summary without the body or code", async () => {
    const { message, setReject } = createMessage();

    await handleIncomingEmail(message, createAppContext());

    expect(messageRepoState.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      parseState.result,
      "household-1",
      "provider-1",
      matched,
    );
    expect(setReject).not.toHaveBeenCalled();
    const stored = events(logSpy).find((e) => e.event === "email_stored");
    expect(stored).toMatchObject({ providerKey: "netflix", codeFound: true });
    expect(JSON.stringify(stored)).not.toContain("123456");
  });

  it("quarantines unmatched senders within the resolved household", async () => {
    classifyState.result = {
      kind: "quarantine",
      householdId: "household-1",
      reason:
        "No sender rule matched the inbound email within the addressed household.",
      code: "654321",
    };
    const { message, setReject } = createMessage();

    await handleIncomingEmail(message, createAppContext());

    expect(messageRepoState.insertQuarantineMessage).toHaveBeenCalledWith(
      expect.anything(),
      parseState.result,
      "household-1",
      classifyState.result,
    );
    expect(setReject).not.toHaveBeenCalled();
    expect(events(logSpy).some((e) => e.event === "email_quarantined")).toBe(
      true,
    );
  });

  it("rejects mail for unknown recipients with a reason instead of dropping it silently", async () => {
    classifyState.result = {
      kind: "quarantine",
      householdId: null,
      reason: "No household matched the inbound recipient address.",
      code: null,
    };
    const { message, setReject } = createMessage();

    await handleIncomingEmail(message, createAppContext());

    expect(setReject).toHaveBeenCalledWith("Unknown recipient");
    expect(messageRepoState.insertQuarantineMessage).not.toHaveBeenCalled();
    expect(events(logSpy)).toContainEqual(
      expect.objectContaining({
        event: "email_rejected",
        reason: "unknown_recipient",
      }),
    );
  });

  it("rejects oversized messages before parsing", async () => {
    const { message, setReject } = createMessage({
      rawSize: MAX_RAW_MESSAGE_BYTES + 1,
    });

    await handleIncomingEmail(message, createAppContext());

    expect(setReject).toHaveBeenCalledWith("Message too large");
    expect(messageRepoState.insertMessage).not.toHaveBeenCalled();
  });

  it("refuses new quarantine rows once a household's quarantine is full", async () => {
    classifyState.result = {
      kind: "quarantine",
      householdId: "household-1",
      reason: "no rule",
      code: null,
    };
    messageRepoState.countUnreviewedQuarantine.mockResolvedValue(
      MAX_UNREVIEWED_QUARANTINE,
    );
    const { message, setReject } = createMessage();

    await handleIncomingEmail(message, createAppContext());

    expect(setReject).toHaveBeenCalledWith("Mailbox quarantine is full");
    expect(messageRepoState.insertQuarantineMessage).not.toHaveBeenCalled();
  });

  it("rejects unparseable messages permanently", async () => {
    parseState.error = new Error("boom");
    const { message, setReject } = createMessage();

    await handleIncomingEmail(message, createAppContext());

    expect(setReject).toHaveBeenCalledWith("Message could not be parsed");
    expect(events(errorSpy)).toContainEqual(
      expect.objectContaining({ event: "email_parse_failed" }),
    );
  });

  it("logs and re-throws unexpected storage failures so the sender retries", async () => {
    messageRepoState.insertMessage.mockRejectedValue(
      new Error("D1 unavailable"),
    );
    const { message, setReject } = createMessage();

    await expect(
      handleIncomingEmail(message, createAppContext()),
    ).rejects.toThrow("D1 unavailable");
    expect(setReject).not.toHaveBeenCalled();
    expect(events(errorSpy)).toContainEqual(
      expect.objectContaining({
        event: "email_ingest_failed",
        messageId: "<message-1@test>",
        error: "D1 unavailable",
      }),
    );
  });
});
