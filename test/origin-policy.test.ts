import { describe, expect, it } from "vitest";

import { appOrigin, corsOriginFor } from "../src/server/security/origin";

const production = {
  APP_URL: "https://casa.example.com",
  ENVIRONMENT: "production",
};
const development = {
  APP_URL: "http://localhost:8787",
  ENVIRONMENT: "development",
};

describe("origin policy", () => {
  it("derives the app origin from APP_URL", () => {
    expect(appOrigin(production)).toBe("https://casa.example.com");
    expect(appOrigin({ APP_URL: "nope" })).toBeNull();
  });

  it("only grants credentialed CORS to the app's own origin", () => {
    expect(corsOriginFor(production, "https://casa.example.com")).toBe(
      "https://casa.example.com",
    );
    expect(corsOriginFor(production, "https://evil.example")).toBe("");
    expect(corsOriginFor(production, "https://sub.casa.example.com")).toBe("");
    expect(corsOriginFor(production, "http://localhost:5173")).toBe("");
    expect(corsOriginFor(production, undefined)).toBe("");
  });

  it("allows localhost origins only in development", () => {
    expect(corsOriginFor(development, "http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
    expect(corsOriginFor(development, "http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173",
    );
    expect(corsOriginFor(development, "https://evil.example")).toBe("");
  });
});
