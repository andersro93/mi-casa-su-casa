/**
 * The Limen auth client — everything the SPA does that is *not* an `/api/*`
 * app route: sign in, sign out, the two-factor challenge and enrolment, and
 * the password reset/change flows (REF §B5).
 *
 * It replaces the Better Auth browser client. Only the slice of Limen's HTTP
 * surface the Go server actually mounts is used here; the rest is disabled
 * server-side (`apps/server/internal/auth/auth.go`, `disabledRouteIDs`) and
 * would 404. Notably `list-sessions` and `revoke-sessions` are disabled on
 * purpose — Limen serialises every session *including its raw token* — so the
 * signed-in devices list and its revocation stay on `/api/settings`, which
 * returns a row id and an address digest and never a token.
 *
 * Wire shapes: the SDK serialises camelCase inputs to snake_case
 * (`newPassword` → `new_password`, `rememberMe` → `remember_me`) and
 * camelises snake_case response keys on the way back, so the camelCase names
 * below are what both this file and the server expect. Every call *throws* a
 * `LimenError` on a non-2xx rather than resolving to `{data, error}` the way
 * Better Auth did — hence the try/catch shape at each call site.
 */

import { credentialPasswordPlugin, twoFactorPlugin } from "limen-auth/plugins";
import { createAuthClient } from "limen-auth/react";
import type { SessionData } from "../types";
import { API_BASE } from "./api";

/** Where the Go server mounts Limen's router (`auth.BasePath`). */
const AUTH_BASE_PATH = "/api/auth";

export const authClient = createAuthClient({
  // Same origin, exactly as lib/api.ts: Limen's fetcher concatenates
  // baseURL + path, so "" yields a relative URL the browser resolves itself.
  baseURL: API_BASE,
  basePath: AUTH_BASE_PATH,
  plugins: [
    credentialPasswordPlugin(),
    // The plugin's after-hook on sign-in fires this when the server answers
    // `{"two_factor_required": true}`. The login page routes itself off the
    // value `signIn.credential` resolves with (below), so there is nothing
    // for the SDK to do here; a redirect from inside the SDK would race the
    // page's own navigation.
    twoFactorPlugin({ onTwoFactorRedirect: () => {} }),
  ],
});

/**
 * The awaited "who is signed in?" check the router's guards run through
 * TanStack Query (`lib/session.ts`). Resolves to `null` when nobody is —
 * Limen answers 401 for an absent or expired session, which the SDK surfaces
 * as `data: null` rather than an error.
 */
export async function getSession(): Promise<SessionData | null> {
  const session = await authClient.getSession();
  return (session as SessionData | null) ?? null;
}

export type SignInResult = {
  /**
   * True when the account has two-step verification on: the server revoked
   * the session it had just issued, set a challenge cookie and answered
   * `{"two_factor_required": true}`. The caller must send the visitor to
   * `/two-factor`; they are *not* signed in yet.
   */
  twoFactorRequired: boolean;
};

/**
 * Email + password. Limen calls the identifier a "credential" because a
 * server can enable usernames; ours is always the email address.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  const result = await authClient.signIn.credential({
    credential: email,
    password,
  });
  // A two-factor challenge comes back as a plain object rather than a
  // session, camelised by the SDK from the server's `two_factor_required`.
  const twoFactorRequired =
    (result as { twoFactorRequired?: boolean }).twoFactorRequired === true;
  return { twoFactorRequired };
}

/**
 * Answer the two-factor challenge. `method: "totp"` covers backup codes too:
 * the server's plugin recognises a backup code by its shape on the same
 * route, which is why the page needs no second call.
 */
export async function verifyTwoFactor(code: string): Promise<void> {
  await authClient.twoFactor.verify({ code, method: "totp" });
}

export const password = {
  /** Send a reset link. The link itself is built server-side. */
  async requestReset(email: string): Promise<void> {
    await authClient.password.requestReset({ email });
  },

  async reset(token: string, newPassword: string): Promise<void> {
    await authClient.password.reset({ token, newPassword });
  },

  /**
   * Change it while signed in. `revokeOtherSessions: false` is passed
   * explicitly because the SDK's route default is `true` — changing a
   * password from the settings screen should not silently sign the account
   * out of its other devices, which is what the devices section is for.
   */
  async change(currentPassword: string, newPassword: string): Promise<void> {
    await authClient.password.change({
      currentPassword,
      newPassword,
      revokeOtherSessions: false,
    });
  },
};

export const twoFactor = {
  /** Step one of enrolment: confirm with the password, get the otpauth URI. */
  async initiateSetup(passwordValue: string): Promise<{ uri: string }> {
    return await authClient.twoFactor.initiateSetup({
      password: passwordValue,
    });
  },

  /** Step two: prove the authenticator app works. Turns two-factor on. */
  async finalizeSetup(code: string): Promise<void> {
    await authClient.twoFactor.finalizeSetup({ code });
  },

  /**
   * Step three: the one-shot codes for a lost phone. Limen mints these with
   * enrolment and only serves them to an already-authenticated caller, so
   * they are fetched after `finalizeSetup`, never alongside `initiateSetup`.
   */
  async getBackupCodes(): Promise<string[]> {
    return await authClient.twoFactor.getBackupCodes();
  },

  async regenerateBackupCodes(): Promise<string[]> {
    return await authClient.twoFactor.regenerateBackupCodes();
  },

  async disable(passwordValue: string): Promise<void> {
    await authClient.twoFactor.disable({ password: passwordValue });
  },
};

/** Sign out of this device. Callers invalidate the session query after. */
export async function signOut(): Promise<void> {
  await authClient.signout();
}
