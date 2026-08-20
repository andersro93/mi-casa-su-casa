import { describe, expect, it } from "vitest";

import {
  MAX_TEXT_BODY_CHARS,
  parseAuthenticationResults,
  parseIncomingEmail,
} from "../src/server/email/parse";

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

  it("truncates very large bodies and flags it", async () => {
    const body = `Your verification code is 123456 ${"x".repeat(MAX_TEXT_BODY_CHARS + 500)}`;
    const parsed = await parseIncomingEmail(
      createMessage(
        [
          "From: Service <login@service.example>",
          "To: casa@example.com",
          "Subject: Big",
          "",
          body,
        ].join("\n"),
      ),
    );

    expect(parsed.textBodyTruncated).toBe(true);
    expect(parsed.textBody.length).toBeLessThanOrEqual(
      MAX_TEXT_BODY_CHARS + 20,
    );
    expect(parsed.textBody.endsWith("[truncated]")).toBe(true);
    expect(parsed.textBody).toContain("123456");
  });

  it("derives a stable synthetic Message-ID when the header is missing", async () => {
    const raw = [
      "From: Service <login@service.example>",
      "To: casa@example.com",
      "Subject: No id",
      "Date: Sun, 10 May 2026 12:00:00 +0000",
      "",
      "Your code is 424242",
    ].join("\n");

    const first = await parseIncomingEmail(createMessage(raw));
    const again = await parseIncomingEmail(createMessage(raw));
    const different = await parseIncomingEmail(
      createMessage(raw.replace("424242", "999999")),
    );

    expect(first.messageId).toMatch(
      /^<synthetic-[0-9a-f]{32}@mi-casa-su-casa>$/,
    );
    expect(again.messageId).toBe(first.messageId);
    expect(different.messageId).not.toBe(first.messageId);
    expect(first.textBodyTruncated).toBe(false);
  });

  it("exposes the From address and Authentication-Results verdicts", async () => {
    const parsed = await parseIncomingEmail(
      createMessage(
        [
          "From: Netflix <Info@Account.Netflix.com>",
          "To: casa@example.com",
          "Subject: Code",
          "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=netflix.com; spf=fail smtp.mailfrom=bounce.example; dmarc=pass header.from=netflix.com",
          "",
          "Your code is 123456",
        ].join("\n"),
      ),
    );

    expect(parsed.fromAddress).toBe("info@account.netflix.com");
    expect(parsed.authentication).toEqual({
      spf: "fail",
      dkim: "pass",
      dmarc: "pass",
    });
  });
});

describe("parseAuthenticationResults", () => {
  it("returns null without a header and reads the first verdict per mechanism", () => {
    expect(parseAuthenticationResults([])).toBeNull();
    expect(
      parseAuthenticationResults([
        "mx.cloudflare.net; spf=pass smtp.mailfrom=x; dkim=none",
        "other; dkim=pass; dmarc=fail",
      ]),
    ).toEqual({ spf: "pass", dkim: "none", dmarc: "fail" });
  });
});
