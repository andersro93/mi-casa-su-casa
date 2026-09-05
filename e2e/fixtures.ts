import { test as base, expect } from "@playwright/test";
import { BASE_URL, clientAddressHeaders } from "./helpers";

// Two things every spec needs and no spec should have to remember.
//
// 1. Clipboard access. Copying is not decoration in this app — it is the
//    action. `CopyButton` only reports success (and the inbox only marks a
//    code as used) when `navigator.clipboard.writeText` resolves, and in a
//    headless context that promise rejects with a permission error unless the
//    origin has been granted clipboard-write. Without this, copy-then-mark-used
//    would fail for a reason that has nothing to do with the app.
//
// 2. Its own client address. The stack runs behind a one-hop proxy contract
//    (TRUSTED_PROXY_HOPS=1) and this header is what the app reads as the
//    caller's address, so each test's browser is one household member as far
//    as the rate limiters are concerned. See helpers.ts's clientAddress.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: BASE_URL,
    });
    await context.setExtraHTTPHeaders(clientAddressHeaders());
    await use(context);
  },
});

export { expect };
