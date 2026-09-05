import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const clientPath = new URL("./apps/frontend/src", import.meta.url).pathname;
const serverPath = new URL("./src/server", import.meta.url).pathname;
const testPath = new URL("./test", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // A bare "@" is safe next to the scoped npm packages: the alias plugin
      // only matches "@" itself or "@/…", never "@mui/…".
      "@": clientPath,
      "@client": clientPath,
      "@server": serverPath,
      "@test": testPath,
    },
  },
  root: "apps/frontend",
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
  },
});
