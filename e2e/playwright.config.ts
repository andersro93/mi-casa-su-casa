import { defineConfig, devices } from "@playwright/test";

// The E2E suite drives the REAL production artifact: the Go binary inside the
// container image, serving the embedded SPA against a real Postgres and a real
// SMTP relay (Mailpit) — never the Vite dev server, so what passes here is
// what ships. Start the stack with `bash scripts/e2e-stack.sh up` (or let
// `mise run e2e` do everything).
//
// Workers = 1 on purpose: every spec shares one database and one installation.
// First-run setup can happen exactly once per stack, the auth routes are rate
// limited per client address, and the owner's household is common ground —
// none of that survives parallel workers, and at this size parallelism buys
// nothing worth the flakiness.
//
// Two projects, one browser engine:
//   mobile   — Pixel 7, the profile the app is designed for. Runs everything.
//   desktop  — Desktop Chrome, which renders the inbox as list + detail rather
//              than a card stack. Runs inbox.spec.ts only (testMatch), because
//              that is the one screen whose LAYOUT differs; re-running the
//              rest would only re-test the same DOM against a wider viewport.
export default defineConfig({
  testDir: ".",
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // Both artefacts stay inside e2e/ (where .gitignore expects them): the
  // defaults are resolved against the working directory, and a run started
  // from the repo root would otherwise scatter them there.
  outputDir: "./test-results",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "./playwright-report" }],
  ],
  // Completes first-run setup once per stack and saves the owner's signed-in
  // storage state, so no spec has to depend on running first.
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3300",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /inbox\.spec\.ts/,
    },
  ],
});
