/**
 * Query options for the three things the router's guards need before any
 * screen can render: whether the deployment still needs first-run setup, who
 * (if anyone) is signed in, and which households they belong to.
 *
 * They live here rather than in `queries/` because both `beforeLoad`
 * (imperatively, via `queryClient.ensureQueryData`) and the screens
 * (reactively, via `useQuery`) read exactly the same cache entries — that is
 * what keeps the shell, its children and the guards from disagreeing.
 */
import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import type { HouseholdSummary, SessionData, SetupStatus } from "../types";
import { ApiError, client, unwrap } from "./api";
import { getSession, SessionUnavailableError, signOut } from "./auth-client";

/** Set by the invite page before it sends a signed-out visitor to sign in. */
export const PENDING_INVITE_KEY = "pendingInviteToken";

/**
 * Setup and household loads resolve to a result object instead of rejecting:
 * a guard that throws on a network blip would replace the app with an error
 * screen, where the pre-router app showed the page plus an inline message.
 */
export type SetupStatusResult = {
  status: SetupStatus | null;
  error: string | null;
};

export type HouseholdsResult = {
  households: HouseholdSummary[];
  error: string | null;
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const setupStatusQueryOptions = queryOptions({
  queryKey: ["setup-status"] as const,
  queryFn: async (): Promise<SetupStatusResult> => {
    try {
      return {
        status: await unwrap<SetupStatus>(client.GET("/api/setup/status")),
        error: null,
      };
    } catch (error) {
      return {
        status: null,
        error: messageOf(error, "Unable to check setup status"),
      };
    }
  },
  staleTime: 30_000,
});

/**
 * Who is signed in — or, just as importantly, the admission that we could not
 * find out.
 *
 * The third state is the point. `GET /api/auth/me` sits behind Limen's
 * 60/min-per-client limiter, so an ordinary busy tab (or a household behind
 * one NAT) can meet a 429; a restart or a proxy hiccup can meet a 5xx or
 * nothing at all. Collapsing any of those into "anonymous" is what used to
 * throw a visitor with a perfectly good session out to `/login`.
 *
 * `unavailable` is not a value in this union because it is never cached: the
 * query *rejects* with `SessionUnavailableError`, which is what lets
 * TanStack Query retry it and what leaves the last known answer in the cache
 * for the guards to keep using (`lib/guards.ts`).
 */
export type SessionResult =
  | { status: "anonymous"; user: null }
  | { status: "signed-in"; user: NonNullable<SessionData["user"]> };

/**
 * The server said nobody is signed in — or we just signed them out. Frozen
 * because it is seeded straight into the query cache and shared by every
 * guard that falls back to it; nothing may edit the answer in place.
 */
export const ANONYMOUS_SESSION: SessionResult = Object.freeze({
  status: "anonymous",
  user: null,
});

/**
 * How many times a session lookup that never got an answer is retried before
 * the guards fall back to the cache (or the error screen). Two is enough to
 * ride out a limiter window boundary or a single dropped request without
 * making an outage worse.
 */
export const SESSION_RETRY_COUNT = 2;
const SESSION_RETRY_BASE_MS = 300;
const SESSION_RETRY_MAX_MS = 5_000;

export const sessionQueryOptions = queryOptions({
  queryKey: ["session"] as const,
  queryFn: async (): Promise<SessionResult> => {
    // Throws `SessionUnavailableError` for anything that is not a definitive
    // 401; see `lib/auth-client.ts`.
    const session = await getSession();
    const user = session?.user;

    // A 200 that names nobody is the same answer as a 401. The old
    // `isAuthenticated` drew the line at the email address and screens rely
    // on it being there, so the line stays where it was.
    return user?.email ? { status: "signed-in", user } : ANONYMOUS_SESSION;
  },
  staleTime: 30_000,
  // Only a lookup that failed to happen is worth repeating. Anything else
  // thrown here is a bug in the query function and should surface at once.
  retry: (failureCount, error) =>
    error instanceof SessionUnavailableError &&
    failureCount < SESSION_RETRY_COUNT,
  retryDelay: (attempt, error) => {
    // The limiter tells us exactly how long it wants; retrying sooner just
    // spends another request on another 429.
    if (
      error instanceof SessionUnavailableError &&
      error.retryAfterMs !== null
    ) {
      // Capped, though: a limiter window can be a full minute away, and
      // freezing a route guard for that long is worse than giving up and
      // letting the cache (or the error screen's own retry) take over.
      return Math.min(error.retryAfterMs, SESSION_RETRY_MAX_MS);
    }
    return Math.min(SESSION_RETRY_BASE_MS * 3 ** attempt, SESSION_RETRY_MAX_MS);
  },
});

export const householdsQueryOptions = queryOptions({
  queryKey: ["households"] as const,
  staleTime: 30_000,
  queryFn: async (): Promise<HouseholdsResult> => {
    try {
      const response = await unwrap<{ households: HouseholdSummary[] }>(
        client.GET("/api/settings/households"),
      );
      return { households: response.households, error: null };
    } catch (error) {
      // A 401 here is not something to tell the user about: it means the
      // session ended (a sign-out, an expiry), and the guards are already
      // sending them to /login. Reporting it would flash "Unauthorized" over
      // the sign-in screen on the way out.
      if (error instanceof ApiError && error.status === 401) {
        return { households: [], error: null };
      }
      return {
        households: [],
        error: messageOf(error, "Unable to load households"),
      };
    }
  },
});

export function isAuthenticated(
  session: SessionResult | undefined,
): session is Extract<SessionResult, { status: "signed-in" }> {
  return session?.status === "signed-in";
}

/**
 * After a sign-in, sign-out, invite acceptance or first-run setup, who the
 * visitor is and what they can see have both changed. Marking the two queries
 * invalidated makes the next guard refetch them rather than trust the cache.
 */
export function invalidateAuthQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey }),
    queryClient.invalidateQueries({
      queryKey: householdsQueryOptions.queryKey,
    }),
  ]).then(() => undefined);
}

/** Household list changed (created, renamed, left) but the account did not. */
export function invalidateHouseholds(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: householdsQueryOptions.queryKey,
  });
}

const SIGNED_OUT_HOUSEHOLDS: HouseholdsResult = { households: [], error: null };

/**
 * Sign out, then *seed* the cache with the signed-out answer rather than
 * invalidating it.
 *
 * Invalidating is wrong on the way out: the chrome's households observer is
 * still mounted at that moment, so it would refetch a list the visitor is no
 * longer entitled to, race the redirect, and — before `householdsQueryOptions`
 * learned to swallow a 401 — flash "Unauthorized" over the sign-in screen.
 * Seeding makes the next guard read "nobody is signed in" synchronously, with
 * no request at all.
 *
 * The seeding happens whether or not the request succeeded, and this never
 * rejects. Limen's `/signout` is a *protected* route that throws on any
 * non-2xx, unlike Better Auth's result object: a session that has already
 * expired or been revoked elsewhere answers 401, and the auth limiter answers
 * 429. Neither is a reason to strand someone on a screen they have just asked
 * to leave — a 401 means they are signed out already, and a 429 leaves a
 * server-side session this client cannot reach anyway (the cookie is
 * HttpOnly). Either way the honest local answer is "signed out", and the next
 * guard re-checks with the server once `clearAuthQueries` drops the seed.
 */
export async function signOutAndReset(queryClient: QueryClient): Promise<void> {
  try {
    await signOut();
  } catch {
    // Deliberately swallowed; see above.
  }
  queryClient.setQueryData(sessionQueryOptions.queryKey, ANONYMOUS_SESSION);
  queryClient.setQueryData(
    householdsQueryOptions.queryKey,
    SIGNED_OUT_HOUSEHOLDS,
  );
}

/**
 * Drop the seeded entries once the redirect has landed, so the next sign-in —
 * possibly as a different account — starts from an empty cache.
 */
export function clearAuthQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
  queryClient.removeQueries({ queryKey: householdsQueryOptions.queryKey });
  queryClient.removeQueries({ queryKey: setupStatusQueryOptions.queryKey });
}

export function useSetupStatus(): SetupStatusResult {
  const { data } = useQuery(setupStatusQueryOptions);
  return data ?? { status: null, error: null };
}

export function useSessionData(): SessionData | null {
  const { data } = useQuery(sessionQueryOptions);
  // A lookup that failed leaves `data` at the last answer it did get, so the
  // chrome keeps showing the account it was showing a moment ago rather than
  // blanking out over a 429.
  return data?.status === "signed-in" ? { user: data.user } : null;
}

export function useHouseholds(): HouseholdsResult {
  const { data } = useQuery(householdsQueryOptions);
  return data ?? { households: [], error: null };
}

/** The household a `/$slug` route is showing, read from the shared query. */
export function useHousehold(slug: string): HouseholdSummary | null {
  const { households } = useHouseholds();
  return households.find((household) => household.slug === slug) ?? null;
}
