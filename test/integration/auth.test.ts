import { authForEnv, provisioningAuthForEnv } from "@server/auth/auth";
import { describe, expect, it } from "vitest";

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
