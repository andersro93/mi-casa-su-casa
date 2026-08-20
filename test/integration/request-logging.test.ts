import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

describe("failed API request logging", () => {
  it("logs 4xx/5xx API responses with method, path, status and ray", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await SELF.fetch(
        "http://localhost:8787/api/does-not-exist",
        {
          headers: { "cf-ray": "abc123-OSL" },
        },
      );
      expect(response.status).toBe(404);

      const line = warn.mock.calls
        .map((call) => String(call[0]))
        .find((entry) => entry.includes("api_request_failed"));
      expect(line).toBeDefined();
      expect(JSON.parse(line as string)).toMatchObject({
        event: "api_request_failed",
        level: "warn",
        method: "GET",
        path: "/api/does-not-exist",
        status: 404,
        ray: "abc123-OSL",
      });
    } finally {
      warn.mockRestore();
    }
  });
});
