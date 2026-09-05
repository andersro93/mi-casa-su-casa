import { describe, expect, it } from "vitest";

import {
  COLOR_MODE_STORAGE_KEY,
  FONT_FAMILY_BODY,
  FONT_FAMILY_HEADING,
  getTheme,
  persistColorMode,
  readStoredColorMode,
  resolveColorMode,
} from "../src/theme";

function luminance(hex: string) {
  const channels = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("getTheme", () => {
  it("uses the self-hosted Inter body font and Nunito for headings", () => {
    const theme = getTheme("light");
    expect(theme.typography.fontFamily).toBe(FONT_FAMILY_BODY);
    expect(theme.typography.fontFamily).toContain("Inter Variable");
    // The per-variant families are what components actually render with.
    expect(theme.typography.body1.fontFamily).toBe(FONT_FAMILY_BODY);
    expect(theme.typography.body2.fontFamily).toBe(FONT_FAMILY_BODY);
    expect(theme.typography.button.fontFamily).toBe(FONT_FAMILY_BODY);
    expect(theme.typography.h1.fontFamily).toBe(FONT_FAMILY_HEADING);
    expect(theme.typography.h1.fontFamily).toContain("Nunito Variable");
    expect(theme.typography.button.textTransform).toBe("none");
  });

  it("keeps primary buttons readable in both modes (WCAG AA)", () => {
    const light = getTheme("light");
    expect(
      contrast(light.palette.primary.main, light.palette.primary.contrastText),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(light.palette.text.primary, light.palette.background.default),
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrast(light.palette.text.secondary, light.palette.background.paper),
    ).toBeGreaterThanOrEqual(4.5);

    const dark = getTheme("dark");
    expect(
      contrast(dark.palette.primary.main, dark.palette.background.default),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(dark.palette.primary.main, dark.palette.primary.contrastText),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(dark.palette.text.primary, dark.palette.background.paper),
    ).toBeGreaterThanOrEqual(7);
  });

  it("uses the warm brand palette rather than the old indigo", () => {
    const light = getTheme("light");
    expect(light.palette.primary.main.toUpperCase()).toBe("#B55326");
    expect(light.palette.background.default.toUpperCase()).toBe("#F7F8F2");
    expect(getTheme("dark").palette.primary.main.toUpperCase()).toBe("#F38466");
  });
});

describe("colour mode persistence", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      data,
    };
  }

  it("defaults to following the system when nothing (or junk) is stored", () => {
    expect(readStoredColorMode(memoryStorage())).toBe("system");
    expect(
      readStoredColorMode(memoryStorage({ [COLOR_MODE_STORAGE_KEY]: "blue" })),
    ).toBe("system");
    expect(readStoredColorMode(null)).toBe("system");
    expect(resolveColorMode("system", true)).toBe("dark");
    expect(resolveColorMode("system", false)).toBe("light");
  });

  it("honours an explicit stored choice over the system preference", () => {
    const storage = memoryStorage({ [COLOR_MODE_STORAGE_KEY]: "dark" });
    expect(readStoredColorMode(storage)).toBe("dark");
    expect(resolveColorMode("dark", false)).toBe("dark");
    expect(resolveColorMode("light", true)).toBe("light");
  });

  it("persists explicit choices and clears the key for system", () => {
    const storage = memoryStorage();
    persistColorMode(storage, "dark");
    expect(storage.data.get(COLOR_MODE_STORAGE_KEY)).toBe("dark");
    persistColorMode(storage, "system");
    expect(storage.data.has(COLOR_MODE_STORAGE_KEY)).toBe(false);
    expect(() =>
      persistColorMode(
        {
          setItem: () => {
            throw new Error("quota");
          },
          removeItem: () => {},
        },
        "light",
      ),
    ).not.toThrow();
  });
});
