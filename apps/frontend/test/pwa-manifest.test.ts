import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicDir = new URL("../public/", import.meta.url);

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
}

function loadManifest(): Manifest {
  return JSON.parse(
    readFileSync(new URL("manifest.webmanifest", publicDir), "utf8"),
  ) as Manifest;
}

describe("web app manifest", () => {
  const manifest = loadManifest();

  it("describes an installable standalone app rooted at /", () => {
    expect(manifest.name).toBe("Mi Casa Su Casa");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("ships the icon sizes Android and iOS need, and every icon file exists", () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(
      manifest.icons.some(
        (icon) => icon.sizes === "512x512" && icon.purpose === "maskable",
      ),
    ).toBe(true);

    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("/")).toBe(true);
      expect(icon.type).toBe("image/png");
      expect(
        existsSync(new URL(`.${icon.src}`, publicDir)),
        `${icon.src} is missing from apps/frontend/public`,
      ).toBe(true);
    }

    expect(existsSync(new URL("icons/apple-touch-icon.png", publicDir))).toBe(
      true,
    );
  });

  it("ships a service worker at the scope root", () => {
    const sw = readFileSync(new URL("sw.js", publicDir), "utf8");
    expect(sw).toContain('addEventListener("fetch"');
    // Auth and inbox data must never be cached by the worker.
    expect(sw).toContain("/api/");
  });
});

describe("index.html PWA wiring", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("links the manifest and declares theme colour", () => {
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="theme-color"');
  });

  it("carries the iOS home-screen metadata Safari needs", () => {
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
  });
});
