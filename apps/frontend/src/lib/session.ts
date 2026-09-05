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
import { getSession, signOut } from "./auth-client";

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

export const sessionQueryOptions = queryOptions({
  queryKey: ["session"] as const,
  queryFn: async (): Promise<SessionData | null> => {
    try {
      return await getSession();
    } catch {
      // A failed session lookup means "not signed in" here, the same as it
      // did when the app read Better Auth's session hook. Limen answers 401
      // with `null` rather than throwing, so this only catches a network or
      // 5xx failure — in which case the guards send the visitor to /login,
      // which is the safe direction.
      return null;
    }
  },
  staleTime: 30_000,
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

export function isAuthenticated(session: SessionData | null): boolean {
  return Boolean(session?.user?.email);
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
  queryClient.setQueryData(sessionQueryOptions.queryKey, null);
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
  return data ?? null;
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
