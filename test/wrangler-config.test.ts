import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function loadWranglerConfig() {
  const raw = readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );
  // Strip // line comments (the file has no block comments or URLs in strings).
  const json = raw
    .split("\n")
    .map((line: string) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
  return JSON.parse(json) as {
    keep_vars?: boolean;
    vars?: Record<string, string>;
    env?: Record<string, { vars?: Record<string, string> }>;
  };
}

describe("wrangler.jsonc deployment contract", () => {
  const config = loadWranglerConfig();

  it("preserves dashboard-configured variables across deploys", () => {
    // Operators set APP_URL / OWNER_EMAIL / OUTBOUND_EMAIL_FROM in the dashboard;
    // without keep_vars every deploy would delete them (#81).
    expect(config.keep_vars).toBe(true);
  });

  it("sets NODE_ENV=production for deployed environments so Better Auth enforces production safeguards", () => {
    expect(config.env?.preview?.vars?.NODE_ENV).toBe("production");
    expect(config.env?.production?.vars?.NODE_ENV).toBe("production");
  });

  it("never ships local development values to deployed environments", () => {
    for (const name of ["preview", "production"]) {
      const vars = config.env?.[name]?.vars ?? {};
      expect(vars.APP_URL, `${name} must not hardcode APP_URL`).toBeUndefined();
      expect(
        vars.OWNER_EMAIL,
        `${name} must not hardcode OWNER_EMAIL`,
      ).toBeUndefined();
      expect(vars.ENVIRONMENT).toBe(name);
    }
  });
});
