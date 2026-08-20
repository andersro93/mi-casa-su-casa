import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import { describe, expect, it } from "vitest";

import { count, testEnv } from "./helpers";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what authenticator apps produce. */
async function totp(secretBase32: string, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretBase32) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = Math.floor(now / 1000 / 30);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, message as unknown as BufferSource),
  );
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function cookiesFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

async function post(path: string, body: unknown, cookie = "") {
  return SELF.fetch(`http://localhost:8787${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:8787",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("two-factor authentication (end-to-end against D1)", () => {
  it("enrols with a verified TOTP, then requires the code (or a backup code) at sign-in", async () => {
    const password = "averylongpassword123";
    const signUp = await provisioningAuthForEnv(testEnv()).api.signUpEmail({
      body: { email: "owner@example.com", name: "Owner", password },
      returnHeaders: true,
    });
    const sessionCookie = signUp.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");

    // 1. Enable: returns the TOTP URI + backup codes but is NOT active yet.
    const enable = await post(
      "/api/auth/two-factor/enable",
      { password },
      sessionCookie,
    );
    expect(enable.status).toBe(200);
    const enabled = await enable.json<{
      totpURI: string;
      backupCodes: string[];
    }>();
    const secret = new URL(enabled.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    expect(enabled.backupCodes.length).toBeGreaterThan(0);
    expect(await count("user", "twoFactorEnabled = 1")).toBe(0);

    // 2. Verify a real code → active.
    const verify = await post(
      "/api/auth/two-factor/verify-totp",
      { code: await totp(secret as string) },
      sessionCookie,
    );
    expect(verify.status).toBe(200);
    expect(await count("user", "twoFactorEnabled = 1")).toBe(1);

    // 3. Fresh sign-in: no session, twoFactorRedirect instead.
    const signIn = await post("/api/auth/sign-in/email", {
      email: "owner@example.com",
      password,
    });
    expect(signIn.status).toBe(200);
    await expect(signIn.json()).resolves.toMatchObject({
      twoFactorRedirect: true,
    });
    const pendingCookie = cookiesFrom(signIn);
    expect(pendingCookie).toMatch(/two_factor/);

    // Wrong code is refused; the right TOTP completes the sign-in.
    const wrong = await post(
      "/api/auth/two-factor/verify-totp",
      { code: "000000" },
      pendingCookie,
    );
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const right = await post(
      "/api/auth/two-factor/verify-totp",
      { code: await totp(secret as string) },
      pendingCookie,
    );
    expect(right.status).toBe(200);
    const signedInCookie = cookiesFrom(right);
    expect(signedInCookie).toMatch(/session_token/);

    const settings = await SELF.fetch("http://localhost:8787/api/settings", {
      headers: { cookie: signedInCookie },
    });
    expect(settings.status).toBe(200);

    // 4. Backup codes also complete a challenge, once.
    const signInAgain = await post("/api/auth/sign-in/email", {
      email: "owner@example.com",
      password,
    });
    const pendingAgain = cookiesFrom(signInAgain);
    const backup = await post(
      "/api/auth/two-factor/verify-backup-code",
      { code: enabled.backupCodes[0] },
      pendingAgain,
    );
    expect(backup.status).toBe(200);
    expect(cookiesFrom(backup)).toMatch(/session_token/);
  });
});
