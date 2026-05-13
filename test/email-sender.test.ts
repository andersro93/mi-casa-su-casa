import { describe, expect, it, vi } from "vitest";

import {
  sendHouseholdInvitationEmail,
  sendPasswordResetEmail,
  sendTransactionalEmail,
} from "../src/server/email/sender";

function createEnv() {
  const send = vi.fn(async () => undefined);

  return {
    env: {
      EMAIL: { send },
      OUTBOUND_EMAIL_FROM: "noreply@example.com",
    } as unknown as Env,
    send,
  };
}

describe("email sender helpers", () => {
  it("sends a transactional email with the configured sender", async () => {
    const { env, send } = createEnv();

    await sendTransactionalEmail(env, {
      to: "member@example.com",
      subject: "Hello",
      text: "Plain text",
      html: "<p>Plain text</p>",
    });

    expect(send).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "member@example.com",
      subject: "Hello",
      text: "Plain text",
      html: "<p>Plain text</p>",
    });
  });

  it("throws when the outbound sender is missing", async () => {
    const send = vi.fn(async () => undefined);
    const env = {
      EMAIL: { send },
      OUTBOUND_EMAIL_FROM: "",
    } as unknown as Env;

    await expect(
      sendTransactionalEmail(env, {
        to: "member@example.com",
        subject: "Hello",
        text: "Plain text",
      }),
    ).rejects.toThrow(
      "OUTBOUND_EMAIL_FROM must be configured before sending email.",
    );
  });

  it("renders a password reset email with escaped HTML", async () => {
    const { env, send } = createEnv();

    await sendPasswordResetEmail(env, {
      to: "member@example.com",
      recipientName: "<Admin>",
      resetUrl: "https://example.com/reset?token=<unsafe>",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        subject: "Reset your Mi Casa Su Casa password",
        text: expect.stringContaining(
          "Use this link to choose a new password: https://example.com/reset?token=<unsafe>",
        ),
        html: expect.stringContaining(
          "https://example.com/reset?token=&lt;unsafe&gt;",
        ),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Hi &lt;Admin&gt;,"),
      }),
    );
  });

  it("renders a household invitation email with role and expiry details", async () => {
    const { env, send } = createEnv();

    await sendHouseholdInvitationEmail(env, {
      to: "invitee@example.com",
      inviteeName: "Taylor",
      inviterName: "Morgan",
      inviterEmail: "morgan@example.com",
      inviteUrl: "https://example.com/invite/token-123",
      expiresAt: "2026-05-31T12:00:00.000Z",
      role: "owner",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "invitee@example.com",
        subject: "Morgan invited you to Mi Casa Su Casa",
        text: expect.stringContaining(
          "invited you to join Mi Casa Su Casa as a Owner.",
        ),
        html: expect.stringContaining("Accept your invitation"),
      }),
    );
  });
});
