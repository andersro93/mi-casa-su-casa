import { SELF } from "cloudflare:test";
import { authForEnv, provisioningAuthForEnv } from "@server/auth/auth";
import { consumeRateLimit, RATE_LIMITS } from "@server/security/rate-limit";
import { describe, expect, it } from "vitest";

import { db, testEnv } from "./helpers";

const WRONG_SETUP = {
  email: "owner@example.com",
  name: "Owner",
  password: "averylongpassword123",
  householdName: "Casa",
  householdSlug: "casa",
  setupSecret: "wrong",
};

async function postSetup(ip: string) {
  return SELF.fetch("http://localhost:8787/api/setup/complete", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(WRONG_SETUP),
  });
}

describe("rate limiting (D1-backed)", () => {
  it("consumeRateLimit counts per window and resets after it", async () => {
    const rule = { name: "t", windowSeconds: 60, max: 2 };
    const t0 = 1_000_000;

    expect(await consumeRateLimit(db, rule, "1.1.1.1", t0)).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect(await consumeRateLimit(db, rule, "1.1.1.1", t0 + 1000)).toEqual({
      allowed: true,
      remaining: 0,
    });
    const blocked = await consumeRateLimit(db, rule, "1.1.1.1", t0 + 2000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    }

    // Other clients are independent; the window eventually resets.
    expect(
      (await consumeRateLimit(db, rule, "2.2.2.2", t0 + 2000)).allowed,
    ).toBe(true);
    expect(
      (await consumeRateLimit(db, rule, "1.1.1.1", t0 + 61_000)).allowed,
    ).toBe(true);
  });

  it("throttles SETUP_SECRET guessing per client address", async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.setup.max; attempt += 1) {
      expect((await postSetup("203.0.113.7")).status).toBe(403);
    }

    const blocked = await postSetup("203.0.113.7");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    // A different client is unaffected.
    expect((await postSetup("203.0.113.8")).status).toBe(403);
  });

  it("throttles invitation token probing", async () => {
    const probe = () =>
      SELF.fetch("http://localhost:8787/api/invitations/lookup", {
        headers: {
          "cf-connecting-ip": "198.51.100.2",
          "x-invitation-token": "does-not-exist",
        },
      });

    for (let attempt = 0; attempt < RATE_LIMITS.invitations.max; attempt += 1) {
      expect((await probe()).status).toBe(404);
    }
    expect((await probe()).status).toBe(429);
  });

  it("Better Auth limits password sign-in attempts per IP using cf-connecting-ip", async () => {
    const env = testEnv();
    await provisioningAuthForEnv(env).api.signUpEmail({
      body: {
        email: "owner@example.com",
        name: "Owner",
        password: "averylongpassword123",
      },
    });

    const attempt = () =>
      SELF.fetch("http://localhost:8787/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:8787",
          "cf-connecting-ip": "192.0.2.10",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "wrong-password-123",
        }),
      });

    for (let i = 0; i < 5; i += 1) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);

    // Unrelated client still gets through (and is still rejected for the wrong password).
    const other = await SELF.fetch(
      "http://localhost:8787/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:8787",
          "cf-connecting-ip": "192.0.2.11",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "wrong-password-123",
        }),
      },
    );
    expect(other.status).toBe(401);

    // Sanity: the configured auth instance is the one SELF serves.
    expect(authForEnv(env)).toBeTruthy();
  });
});
