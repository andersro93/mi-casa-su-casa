import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    twoFactorClient({
      twoFactorPage: "/two-factor",
      // The login page inspects `twoFactorRedirect` itself and navigates with
      // the router, so the plugin must not hard-redirect the window.
      onTwoFactorRedirect() {},
    }),
  ],
  sessionOptions: {
    refetchInterval: 0,
    refetchOnWindowFocus: true,
    refetchWhenOffline: false,
  },
});
