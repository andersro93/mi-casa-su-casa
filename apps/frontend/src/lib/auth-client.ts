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
 *
 * The one route this file does *not* dispatch through the SDK is `GET /me`:
 * `getSession` below explains why, and it is the difference between a
 * rate-limited session check and a sign-out.
 */

import { defaultSessionParse } from "limen-auth";
import { credentialPasswordPlugin, twoFactorPlugin } from "limen-auth/plugins";
import { createAuthClient } from "limen-auth/react";
import type { SessionData } from "../types";
import { API_BASE } from "./api";

/** Where the Go server mounts Limen's router (`auth.BasePath`). */
const AUTH_BASE_PATH = "/api/auth";

export const authClient = createAuthClient({
  // The page's own origin, shared with lib/api.ts so both clients agree on
  // where the server is. Limen's fetcher concatenates baseURL + path, so an
  // absolute origin yields an absolute URL — which is also what keeps the
  // request constructible outside a browser (see API_BASE's own comment).
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
 * The session check could not be *made*, so nothing is known about whether
 * anyone is signed in. That is a different fact from "nobody is", and the
 * guards must not confuse the two (`lib/session.ts`, `lib/guards.ts`).
 *
 * `status` is the HTTP status, or `0` when the request never reached a server
 * at all; `retryAfterMs` is the server's own `Retry-After`, when it sent one.
 */
export class SessionUnavailableError extends Error {
  readonly name = "SessionUnavailableError";
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    status: number,
    retryAfterMs: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * How long the session check waits before deciding the connection is not
 * going to answer.
 *
 * There has to be a deadline. `fetch` on its own never gives up, so a
 * half-open connection — a dropped Wi-Fi handover, a proxy that accepted the
 * socket and died — leaves the guard's promise pending forever and the app
 * stuck behind its loading screen, with no error, no retry and no way out.
 * Limen's own SDK defaulted to 30s; half that is still far longer than a
 * healthy `/me` and half as long to sit staring at a spinner.
 */
export const SESSION_TIMEOUT_MS = 15_000;

/**
 * `Retry-After`, in either of the two forms RFC 9110 allows.
 *
 * A value that has already elapsed — `0`, a negative delta, a date in the
 * past — is reported as *absent* rather than as "retry now": honouring it
 * literally is how one 429 becomes three in the space of a millisecond.
 */
function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get("Retry-After")?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1_000 : null;

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;

  const delay = at - Date.now();
  return delay > 0 ? delay : null;
}

/**
 * An abort — ours on the deadline, or the browser tearing the page down.
 *
 * Read off `name` rather than `instanceof Error`: an abort surfaces as a
 * `DOMException`, and jsdom's does not inherit from `Error`, so the obvious
 * check quietly misclassifies every timeout in the tests as a plain network
 * failure.
 */
function isAbort(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * The awaited "who is signed in?" check the router's guards run through
 * TanStack Query (`lib/session.ts`). Resolves to the session, or to `null`
 * when the server *states* that nobody is signed in — a 401, and only a 401.
 * Every other outcome — the 429 Limen's 60/min limiter answers with, a 5xx, a
 * connection that never lands — throws `SessionUnavailableError`.
 *
 * This calls `GET /api/auth/me` directly rather than through
 * `authClient.getSession()`, for two reasons, both of which were bugs:
 *
 *  1. The SDK's `getSession` awaits a store refetch and then reads the result
 *     with `$state.get()`. Reading a nanostore atom that has no listeners
 *     *mounts* it, and the session store is created with `fetchOnMount: true`
 *     — so the read fires a **second** `GET /me`. Every cold load therefore
 *     spent two of the sixty requests a client gets each minute, on the very
 *     route whose 429 this file now has to survive.
 *  2. That second load synchronously clears `error` on the store before
 *     `.get()` returns, so `if (state.error) throw` never fires on a cold
 *     load: a 429 or a 5xx resolved as `null`, indistinguishable from "signed
 *     out". Which is exactly how a rate-limited visitor got signed out.
 *
 * Nothing else in the app reads Limen's session store — the guards and the
 * chrome both read the TanStack Query cache — so going straight to the route
 * costs nothing. `defaultSessionParse` is the SDK's own normaliser (the
 * snake_case → camelCase pass), and the client is configured with the default
 * envelope `mode: "off"`, so the parsed body is the payload.
 */
export async function getSession(): Promise<SessionData | null> {
  // A hand-rolled controller rather than `AbortSignal.timeout`: it lets the
  // deadline cover reading the body as well as opening the connection, it
  // clears itself the moment the answer lands, and — unlike the platform's
  // internal timer — it is a `setTimeout`, so a test can drive it.
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(
      new DOMException("The session check timed out", "TimeoutError"),
    );
  }, SESSION_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      // `globalThis.fetch` per call rather than a captured reference, for the
      // same reason lib/api.ts dispatches through a closure: a later
      // replacement (a test's stub, a polyfill) must still be honoured.
      response = await globalThis.fetch(`${API_BASE}${AUTH_BASE_PATH}/me`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: deadline.signal,
      });
    } catch (cause) {
      throw new SessionUnavailableError(
        isAbort(cause)
          ? "The session check timed out"
          : "The session check could not reach the server",
        0,
        null,
        { cause },
      );
    }

    // The one definitive answer: no session, or one the server will not
    // honour.
    if (response.status === 401) return null;

    if (!response.ok) {
      throw new SessionUnavailableError(
        `The session check answered ${response.status}`,
        response.status,
        retryAfterMs(response.headers),
      );
    }

    try {
      return defaultSessionParse(await response.json()) as SessionData;
    } catch (cause) {
      // A 200 whose body is not a session — or one whose stream stalled past
      // the deadline — is a failure of the check, not proof that nobody is
      // signed in.
      throw new SessionUnavailableError(
        isAbort(cause)
          ? "The session check timed out"
          : "The session check answered with something unreadable",
        isAbort(cause) ? 0 : response.status,
        null,
        { cause },
      );
    }
  } finally {
    clearTimeout(timer);
  }
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
