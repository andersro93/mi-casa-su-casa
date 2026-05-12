import { defineConfig } from "vitest/config";

const clientPath = new URL("./src/client", import.meta.url).pathname;
const serverPath = new URL("./src/server", import.meta.url).pathname;
const testPath = new URL("./test", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@client": clientPath,
      "@server": serverPath,
      "@test": testPath,
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    coverage: {
      enabled: false,
      reporter: ["text", "html"],
    },
  },
});
