import { describe, expect, it } from "vitest";

import { parseIncomingEmail } from "../src/server/email/parse";

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

describe("parseIncomingEmail", () => {
  it("falls back to stripped html when text is unavailable", async () => {
    const parsed = await parseIncomingEmail(
      createMessage(
        [
          "From: Service <login@service.example>",
          "To: codes@example.com",
          "Subject: Sign in",
          "Content-Type: text/html; charset=utf-8",
          "",
          "<html><body><p>Your verification code is <strong>123456</strong>.</p></body></html>",
        ].join("\n"),
      ),
    );

    expect(parsed.textBody).toContain("Your verification code is 123456");
  });

  it("uses a placeholder when both text and html bodies are empty", async () => {
    const parsed = await parseIncomingEmail(
      createMessage(
        [
          "From: Service <login@service.example>",
          "To: codes@example.com",
          "Subject: Empty body",
          "",
          "",
        ].join("\n"),
      ),
    );

    expect(parsed.textBody).toBe("[empty email body]");
  });
});
