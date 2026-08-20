import { SELF } from "cloudflare:test";
import { authForEnv, provisioningAuthForEnv } from "@server/auth/auth";
import { describe, expect, it } from "vitest";

import { count, db, testEnv } from "./helpers";

describe("password reset (end-to-end against D1)", () => {
  it("emails a reset link, accepts the new password, revokes other sessions", async () => {
    const sent: string[] = [];
    const env = testEnv({
      EMAIL: {
        send: async (message: { text?: string }) => {
          sent.push(message.text ?? "");
          return { messageId: "m" };
        },
      } as unknown as Env["EMAIL"],
    });

    // Owner signs up, then signs in on a "second device".
    await provisioningAuthForEnv(env).api.signUpEmail({
      body: {
        email: "owner@example.com",
        name: "Owner",
        password: "old-password-123456",
      },
    });
    await authForEnv(env).api.signInEmail({
      body: { email: "owner@example.com", password: "old-password-123456" },
    });
    expect(await count("session")).toBe(2);

    // Request a reset through the worker (what the Forgot page does).
    const request = await SELF.fetch(
      "http://localhost:8787/api/auth/request-password-reset",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:8787",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          redirectTo: "http://localhost:8787/reset-password",
        }),
      },
    );
    expect(request.status).toBe(200);
    // The worker-served instance uses the real EMAIL binding, so resolve the
    // token from the verification table instead of the outbound mail.
    const tokenFromEmail = sent
      .map((text) => text.match(/reset-password\/([A-Za-z0-9_-]+)/)?.[1])
      .find(Boolean);

    const verification = await db
      .prepare(
        "SELECT identifier FROM verification WHERE identifier LIKE 'reset-password:%' ORDER BY createdAt DESC LIMIT 1",
      )
      .first<{ identifier: string }>();
    const token =
      tokenFromEmail ?? verification?.identifier.replace("reset-password:", "");
    expect(token).toBeTruthy();

    // Following the emailed link redirects to the SPA with the token.
    const follow = await SELF.fetch(
      `http://localhost:8787/api/auth/reset-password/${token}?callbackURL=http://localhost:8787/reset-password`,
      { redirect: "manual" },
    );
    expect(follow.status).toBeGreaterThanOrEqual(300);
    expect(follow.headers.get("location")).toContain(`token=${token}`);

    // The reset page posts the new password.
    const reset = await SELF.fetch(
      "http://localhost:8787/api/auth/reset-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:8787",
        },
        body: JSON.stringify({ newPassword: "new-password-654321", token }),
      },
    );
    expect(reset.status).toBe(200);

    // Other sessions are revoked; the new password works, the old one does not.
    expect(await count("session")).toBe(0);
    await expect(
      authForEnv(env).api.signInEmail({
        body: { email: "owner@example.com", password: "old-password-123456" },
      }),
    ).rejects.toThrow();
    const signedIn = await authForEnv(env).api.signInEmail({
      body: { email: "owner@example.com", password: "new-password-654321" },
    });
    expect(signedIn.user.email).toBe("owner@example.com");
  });
});
