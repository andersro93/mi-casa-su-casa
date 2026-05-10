import { describe, expect, it, vi } from "vitest";

import { handleIncomingEmail } from "../src/server/email/handler";
import type { AppContext } from "../src/server/runtime/context";

function createMessage(
  raw: string,
  overrides?: Partial<ForwardableEmailMessage>,
) {
  return {
    from: "login@service.example",
    to: "codes@example.com",
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    }),
    rawSize: raw.length,
    headers: new Headers(),
    setReject() {},
    forward() {
      return Promise.resolve();
    },
    reply() {
      return Promise.resolve();
    },
    ...overrides,
  } as unknown as ForwardableEmailMessage;
}

function createDb(match: { providerId: string; providerKey: string } | null) {
  const run = vi.fn(async () => ({ results: [] }));
  const first = vi.fn(async () => match);
  const all = vi.fn(async () => ({ results: match ? [match] : [] }));
  const bind = vi.fn(() => ({ all, first, run }));
  const prepare = vi.fn(() => ({ bind, all, first, run }));

  return {
    db: {
      prepare,
      batch: vi.fn(async () => []),
    } as unknown as D1Database,
    prepare,
    bind,
    all,
    first,
    run,
  };
}

function createAppContext(db: D1Database): AppContext {
  return {
    env: {
      DB: db,
    } as Env,
    executionContext: {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
  };
}

describe("handleIncomingEmail", () => {
  it("persists a matched email to messages without a second provider lookup", async () => {
    const db = createDb({ providerId: "provider-1", providerKey: "netflix" });

    await handleIncomingEmail(
      createMessage(
        [
          "From: Service <login@service.example>",
          "To: codes@example.com",
          "Subject: Verification code",
          "",
          "Your verification code is 123456",
        ].join("\n"),
      ),
      createAppContext(db.db),
    );

    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO messages"),
    );
  });

  it("routes unmatched senders into quarantine", async () => {
    const db = createDb(null);

    await handleIncomingEmail(
      createMessage(
        [
          "From: Unknown <unknown@example.net>",
          "To: codes@example.com",
          "Subject: Sign in",
          "",
          "Use 654321 to continue.",
        ].join("\n"),
        { from: "unknown@example.net" },
      ),
      createAppContext(db.db),
    );

    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO quarantine_messages"),
    );
  });

  it("ignores duplicate message deliveries without failing the handler", async () => {
    const duplicateError = new Error(
      "UNIQUE constraint failed: messages.message_id",
    );
    const run = vi.fn(async () => {
      throw duplicateError;
    });
    const first = vi.fn(async () => ({
      providerId: "provider-1",
      providerKey: "netflix",
    }));
    const all = vi.fn(async () => ({
      results: [{ providerId: "provider-1", providerKey: "netflix" }],
    }));
    const bind = vi.fn(() => ({ all, first, run }));
    const prepare = vi.fn(() => ({ bind, all, first, run }));

    const db = {
      prepare,
      batch: vi.fn(async () => []),
    } as unknown as D1Database;

    await expect(
      handleIncomingEmail(
        createMessage(
          [
            "From: Service <login@service.example>",
            "To: codes@example.com",
            "Subject: Verification code",
            "Message-ID: <duplicate@test>",
            "",
            "Your verification code is 123456",
          ].join("\n"),
        ),
        createAppContext(db),
      ),
    ).resolves.toBeUndefined();

    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO messages"),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
