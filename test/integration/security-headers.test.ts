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

  it("allow the same-origin service worker and web app manifest", async () => {
    const response = await SELF.fetch("http://localhost:8787/api/health/live");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
  });
});

describe("static asset passthrough (workerd)", () => {
  // Responses from the ASSETS binding arrive with immutable headers; the
  // Worker must re-wrap them so the security-header middleware can apply.
  it("serves the SPA shell with security headers", async () => {
    const response = await SELF.fetch("http://localhost:8787/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves hashed assets with security headers", async () => {
    const asset = await SELF.fetch("http://localhost:8787/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("fixture asset");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(asset.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });

  it("falls back to the SPA shell for deep links, with security headers", async () => {
    const deepLink = await SELF.fetch("http://localhost:8787/casa/inbox");
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain('<div id="root">');
    expect(deepLink.headers.get("x-frame-options")).toBe("DENY");
  });
});
