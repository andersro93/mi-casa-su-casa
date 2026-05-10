import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const clientPath = new URL("./src/client", import.meta.url).pathname;
const serverPath = new URL("./src/server", import.meta.url).pathname;
const testPath = new URL("./test", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@client": clientPath,
      "@server": serverPath,
      "@test": testPath,
    },
  },
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
