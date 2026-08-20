import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env extends globalThis.Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
