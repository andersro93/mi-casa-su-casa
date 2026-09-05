import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA's own build. The root vite.config.ts still builds the same sources
// for the Cloudflare Worker deploy (it points `root` here); this config is
// what `bun run --filter @mi-casa/frontend build` and `vite dev` use, and it
// is where the SPA lands once the Worker is retired.
const srcPath = new URL("./src", import.meta.url).pathname;
// Better Auth's browser client still lives with the Worker sources; the alias
// keeps `@server/auth/client` resolvable from here until the Go backend and
// its own auth client replace it.
const serverPath = new URL("../../src/server", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": srcPath,
      "@server": serverPath,
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
    // `wrangler dev` used to serve both halves on one origin. The Go backend
    // runs on 3000, so proxy the API and health endpoints to it and keep the
    // client's same-origin (cookie-bearing) assumption working in dev.
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
      "/readyz": "http://localhost:3000",
    },
  },
});
