import { defineConfig } from "vitest/config";

const srcPath = new URL("./src", import.meta.url).pathname;
const serverPath = new URL("../../src/server", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@": srcPath,
      "@server": serverPath,
    },
  },
  test: {
    name: "frontend",
    // Node by default; the DOM tests opt in with a
    // `// @vitest-environment jsdom` docblock, exactly as they did when they
    // ran in the root "unit" project.
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
