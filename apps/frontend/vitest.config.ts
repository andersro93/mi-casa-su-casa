import { defineConfig } from "vitest/config";

const srcPath = new URL("./src", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@": srcPath,
    },
  },
  test: {
    name: "frontend",
    // Node by default; the DOM tests opt in with a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
