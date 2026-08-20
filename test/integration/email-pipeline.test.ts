import { createExecutionContext, env } from "cloudflare:test";
import { listMessagesForProvider } from "@server/db/repositories/messages";
import {
  createProvider,
  createSenderRule,
} from "@server/db/repositories/provider-rules";
import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

import { count, db, insertHousehold } from "./helpers";

function rawEmail(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId?: string;
  headerFrom?: string;
  authenticationResults?: string;
}) {
  return [
    `From: Service <${input.headerFrom ?? input.from}>`,
    ...(input.authenticationResults
      ? [`Authentication-Results: ${input.authenticationResults}`]
      : []),
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    ...(input.messageId ? [`Message-ID: ${input.messageId}`] : []),
    "Date: Sun, 10 May 2026 12:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].join("\r\n");
}

function emailMessage(input: Parameters<typeof rawEmail>[0]) {
  const raw = rawEmail(input);
  const setReject = vi.fn();
  const message = {
    from: input.from,
    to: input.to,
    raw: new Response(raw).body as ReadableStream<Uint8Array>,
    rawSize: raw.length,
    headers: new Headers(),
    setReject,
    forward: async () => ({ messageId: "fwd" }),
    reply: async () => ({ messageId: "rpl" }),
  } as unknown as ForwardableEmailMessage;
  return { message, setReject };
}

async function deliver(input: Parameters<typeof rawEmail>[0]) {
  const { message, setReject } = emailMessage(input);
  await worker.email?.(
    message,
    env as unknown as Env,
    createExecutionContext(),
  );
  return { setReject };
}

describe("inbound email pipeline (worker.email against D1)", () => {
  it("stores a matched message with its code, and de-duplicates redelivery", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    await createSenderRule(
      db,
      household.id,
      provider.id,
      "domain",
      "netflix.com",
    );

    const mail = {
      from: "info@netflix.com",
      to: "casa@example.com",
      subject: "Your verification code",
      body: "Your verification code is 482913",
      messageId: "<abc@netflix.com>",
    };
    const first = await deliver(mail);
    const second = await deliver(mail);

    expect(first.setReject).not.toHaveBeenCalled();
    expect(second.setReject).not.toHaveBeenCalled();
    const rows = await listMessagesForProvider(db, household.id, "netflix");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      extracted_code: "482913",
      provider_key: "netflix",
    });
  });

  it("quarantines unmatched senders for a known household", async () => {
    const household = await insertHousehold({ slug: "casa" });

    const { setReject } = await deliver({
      from: "someone@unknown.example",
      to: "casa@example.com",
      subject: "Hello",
      body: "No rule for me",
    });

    expect(setReject).not.toHaveBeenCalled();
    expect(
      await count("quarantine_messages", "household_id = ?1", household.id),
    ).toBe(1);
  });

  it("rejects mail addressed to an unknown household instead of dropping it silently", async () => {
    const { setReject } = await deliver({
      from: "info@netflix.com",
      to: "nobody@example.com",
      subject: "Code",
      body: "123456",
    });

    expect(setReject).toHaveBeenCalledWith("Unknown recipient");
    expect(await count("quarantine_messages")).toBe(0);
    expect(await count("messages")).toBe(0);
  });

  it("files mail by the visible From address when the envelope sender is a bounce address", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    await createSenderRule(
      db,
      household.id,
      provider.id,
      "domain",
      "netflix.com",
    );

    const { setReject } = await deliver({
      from: "bounce+abc@amazonses.com",
      headerFrom: "info@account.netflix.com",
      to: "casa@example.com",
      subject: "Code",
      body: "Your verification code is 555444",
      authenticationResults:
        "mx.cloudflare.net; spf=pass smtp.mailfrom=amazonses.com; dkim=pass header.d=netflix.com; dmarc=pass header.from=netflix.com",
    });

    expect(setReject).not.toHaveBeenCalled();
    expect(
      (await listMessagesForProvider(db, household.id, "netflix"))[0],
    ).toMatchObject({
      extracted_code: "555444",
    });
  });

  it("quarantines a spoofed envelope sender that fails SPF even though a rule matches", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    await createSenderRule(
      db,
      household.id,
      provider.id,
      "domain",
      "netflix.com",
    );

    await deliver({
      from: "codes@netflix.com",
      headerFrom: "attacker@attacker.example",
      to: "casa@example.com",
      subject: "Your Netflix code",
      body: "Your verification code is 000000",
      authenticationResults:
        "mx.cloudflare.net; spf=fail smtp.mailfrom=netflix.com; dkim=pass header.d=attacker.example; dmarc=pass header.from=attacker.example",
    });

    expect(
      await listMessagesForProvider(db, household.id, "netflix"),
    ).toHaveLength(0);
    const quarantined = await db
      .prepare("SELECT quarantine_reason FROM quarantine_messages")
      .first<{ quarantine_reason: string }>();
    expect(quarantined?.quarantine_reason).toMatch(/authentication failed/);
  });
});
