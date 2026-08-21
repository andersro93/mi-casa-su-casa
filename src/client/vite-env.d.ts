// Minimal typing for Vite's compile-time env flags (the full `vite/client`
// types are not included because tsconfig pins an explicit `types` list).
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
