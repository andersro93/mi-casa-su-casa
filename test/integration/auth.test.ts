import { authForEnv, provisioningAuthForEnv } from "@server/auth/auth";
import { describe, expect, it, vi } from "vitest";

import { count, testEnv } from "./helpers";

describe("Better Auth against the real schema (D1)", () => {
  it("signs up a credential user through the provisioning instance and can sign in", async () => {
    const env = testEnv();
    const auth = provisioningAuthForEnv(env);

    const result = await auth.api.signUpEmail({
      body: {
        email: "owner@example.com",
        name: "Owner",
        password: "averylongpassword123",
      },
    });

    expect(result.user.email).toBe("owner@example.com");
    expect(await count("user")).toBe(1);
    expect(await count("account", "userId = ?1", result.user.id)).toBe(1);

    const signIn = await authForEnv(env).api.signInEmail({
      body: { email: "owner@example.com", password: "averylongpassword123" },
    });
    expect(signIn.user.id).toBe(result.user.id);
  });

  it("refuses public sign-up on the regular auth instance", async () => {
    await expect(
      authForEnv(testEnv()).api.signUpEmail({
        body: {
          email: "stranger@example.com",
          name: "Stranger",
          password: "averylongpassword123",
        },
      }),
    ).rejects.toThrow();
    expect(await count("user")).toBe(0);
  });
});

describe("password reset email delivery", () => {
  async function signUpOwner(env: Env) {
    await provisioningAuthForEnv(env).api.signUpEmail({
      body: {
        email: "owner@example.com",
        name: "Owner",
        password: "averylongpassword123",
      },
    });
  }

  it("awaits the reset email and logs a structured error when delivery fails", async () => {
    // Better Auth deliberately keeps the public response enumeration-safe, so
    // the request still succeeds; what must not happen is a silently dropped
    // promise. The callback now awaits the send and logs the failure.
    const failing = testEnv({
      EMAIL: {
        send: async () => {
          throw new Error("email binding unavailable");
        },
      } as unknown as Env["EMAIL"],
    });
    await signUpOwner(failing);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await authForEnv(failing).api.requestPasswordReset({
        body: { email: "owner@example.com", redirectTo: "/reset-password" },
      });

      const logged = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes("password_reset_email_failed"));
      expect(logged).toBeDefined();
      expect(JSON.parse(logged as string)).toMatchObject({
        event: "password_reset_email_failed",
        error: "email binding unavailable",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("sends the reset email through the binding when configured", async () => {
    const sent: Array<{ to: unknown; subject: unknown }> = [];
    const working = testEnv({
      EMAIL: {
        send: async (message: { to: unknown; subject: unknown }) => {
          sent.push({ to: message.to, subject: message.subject });
          return { messageId: "m-1" };
        },
      } as unknown as Env["EMAIL"],
    });
    await signUpOwner(working);

    await authForEnv(working).api.requestPasswordReset({
      body: { email: "owner@example.com", redirectTo: "/reset-password" },
    });

    expect(sent).toEqual([
      { to: "owner@example.com", subject: expect.stringMatching(/reset/i) },
    ]);
  });
});
