import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const clientPath = new URL("./src/client", import.meta.url).pathname;
const serverPath = new URL("./src/server", import.meta.url).pathname;
const testPath = new URL("./test", import.meta.url).pathname;

const alias = {
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
            include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
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
