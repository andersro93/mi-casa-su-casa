import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("security headers (workerd)", () => {
  it("are present on live API responses", async () => {
    const response = await SELF.fetch("http://localhost:8787/api/health/live");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });
});
