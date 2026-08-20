import { describe, expect, it } from "vitest";

import { validateEnv } from "../src/server/runtime/env";

function fullEnv(overrides: Partial<Record<keyof Env, unknown>> = {}): Env {
  return {
    APP_NAME: "Mi Casa Su Casa",
    APP_URL: "https://casa.example.com",
    ASSETS: {} as Fetcher,
    AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    DB: {} as D1Database,
    EMAIL: {} as Env["EMAIL"],
    ENVIRONMENT: "production",
    OUTBOUND_EMAIL_FROM: "noreply@casa.example.com",
    OWNER_EMAIL: "owner@example.com",
    SETUP_SECRET: "setup",
    ...overrides,
  } as Env;
}

describe("validateEnv", () => {
  it("accepts a complete production environment", () => {
    expect(validateEnv(fullEnv())).toEqual({ ok: true, problems: [] });
  });

  it("reports every missing required variable and binding", () => {
    const result = validateEnv(
      fullEnv({
        APP_URL: undefined,
        AUTH_SECRET: undefined,
        OUTBOUND_EMAIL_FROM: undefined,
        DB: undefined,
        EMAIL: undefined,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.key).sort()).toEqual(
      ["APP_URL", "AUTH_SECRET", "DB", "EMAIL", "OUTBOUND_EMAIL_FROM"].sort(),
    );
  });

  it("rejects a short AUTH_SECRET", () => {
    const result = validateEnv(fullEnv({ AUTH_SECRET: "too-short" }));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      expect.objectContaining({ key: "AUTH_SECRET" }),
    ]);
  });

  it("requires APP_URL to be an absolute https URL outside development", () => {
    expect(validateEnv(fullEnv({ APP_URL: "not a url" })).ok).toBe(false);
    expect(
      validateEnv(fullEnv({ APP_URL: "http://casa.example.com" })).ok,
    ).toBe(false);
    expect(
      validateEnv(
        fullEnv({
          APP_URL: "http://localhost:8787",
          ENVIRONMENT: "development",
        }),
      ).ok,
    ).toBe(true);
  });

  it("treats an empty string like a missing value", () => {
    expect(validateEnv(fullEnv({ OUTBOUND_EMAIL_FROM: "   " })).ok).toBe(false);
  });
});
