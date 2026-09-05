import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA's build. `bun run --filter @mi-casa/frontend build` writes to
// dist/client, which scripts/build-artifacts.sh copies into the Go binary's
// embedded filesystem (apps/server/internal/web/dist).
const srcPath = new URL("./src", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": srcPath,
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("@mui/icons-material")) {
            return "mui-icons";
          }

          if (id.includes("@mui/material") || id.includes("@emotion")) {
            return "mui-core";
          }

          if (id.includes("react")) {
            return "react-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    // The SPA and the API share an origin in production (the Go binary
    // serves both), so proxy the API and health endpoints to `bun run
    // dev:server` on 3000 and keep the client's same-origin,
    // cookie-bearing assumption working in dev too.
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
      "/readyz": "http://localhost:3000",
    },
  },
});
