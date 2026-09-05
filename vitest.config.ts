import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const clientPath = new URL("./apps/frontend/src", import.meta.url).pathname;
const serverPath = new URL("./src/server", import.meta.url).pathname;
const testPath = new URL("./test", import.meta.url).pathname;

const alias = {
  // A bare "@" is safe next to the scoped npm packages: the alias plugin
  // only matches "@" itself or "@/…", never "@mui/…".
  "@": clientPath,
  "@client": clientPath,
  "@server": serverPath,
  "@test": testPath,
};

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");

  return {
    test: {
      coverage: {
        enabled: false,
        reporter: ["text", "html"],
      },
      projects: [
        {
          resolve: { alias },
          test: {
            name: "unit",
            environment: "node",
            include: [
              "test/**/*.test.ts",
              "test/**/*.test.tsx",
              // The SPA lives in the apps/frontend workspace and has its own
              // vitest.config.ts, but the root run keeps executing its tests
              // so `npm run ci` (which is npm-only, no bun) still covers the
              // whole repo on the existing CI workflow.
              "apps/frontend/test/**/*.test.ts",
              "apps/frontend/test/**/*.test.tsx",
            ],
            exclude: ["test/integration/**"],
          },
        },
        {
          resolve: { alias },
          plugins: [
            cloudflareTest({
              main: "./src/index.ts",
              miniflare: {
                compatibilityDate: "2026-05-10",
                compatibilityFlags: ["nodejs_compat"],
                d1Databases: ["DB"],
                email: { send_email: [{ name: "EMAIL" }] },
                // A tiny stand-in for dist/client so the SPA/asset passthrough
                // (run_worker_first + security headers) is exercised in tests
                // without requiring a Vite build first.
                assets: {
                  directory: "./test/fixtures/assets",
                  binding: "ASSETS",
                  run_worker_first: true,
                  routerConfig: {
                    has_user_worker: true,
                    invoke_user_worker_ahead_of_assets: true,
                  },
                  assetConfig: {
                    not_found_handling: "single-page-application",
                  },
                },
                bindings: {
                  APP_NAME: "Mi Casa Su Casa (test)",
                  APP_URL: "http://localhost:8787",
                  ENVIRONMENT: "test",
                  OWNER_EMAIL: "owner@example.com",
                  AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
                  SETUP_SECRET: "test-setup-secret",
                  OUTBOUND_EMAIL_FROM: "noreply@example.com",
                  TEST_MIGRATIONS: migrations,
                },
              },
            }),
          ],
          test: {
            name: "integration",
            include: ["test/integration/**/*.test.ts"],
            setupFiles: ["./test/integration/setup.ts"],
          },
        },
      ],
    },
  };
});
