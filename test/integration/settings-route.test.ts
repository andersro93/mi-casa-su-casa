import { SELF } from "cloudflare:test";
import { provisioningAuthForEnv } from "@server/auth/auth";
import { listUserSessions } from "@server/db/repositories/settings";
import { describe, expect, it } from "vitest";

import { db, testEnv } from "./helpers";

async function signUpWithCookie() {
  const result = await provisioningAuthForEnv(testEnv()).api.signUpEmail({
    body: {
      email: "owner@example.com",
      name: "Owner",
      password: "averylongpassword123",
    },
    returnHeaders: true,
  });
  const cookie = result.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { userId: result.response.user.id, cookie };
}

describe("account settings (end-to-end against D1)", () => {
  it("lists sessions without exposing tokens and flags the current one", async () => {
    const { userId, cookie } = await signUpWithCookie();

    const response = await SELF.fetch("http://localhost:8787/api/settings", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const payload = await response.json<{
      sessions: Array<Record<string, unknown>>;
    }>();
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]).toMatchObject({ isCurrent: true });
    expect(JSON.stringify(payload)).not.toMatch(/"token"/);

    const rows = await listUserSessions(db, userId);
    expect(rows[0]).not.toHaveProperty("token");
  });

  it("requires a session", async () => {
    const response = await SELF.fetch("http://localhost:8787/api/settings");
    expect(response.status).toBe(401);
  });
});
