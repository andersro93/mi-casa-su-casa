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
import { authClient } from "@server/auth/client";
import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import type { HouseholdSummary, SessionData, SetupStatus } from "../types";
import { fetchJson } from "../utils";

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
        status: await fetchJson<SetupStatus>("/api/setup/status"),
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
      const { data } = await authClient.getSession();
      return (data as SessionData | null) ?? null;
    } catch {
      // A failed session lookup means "not signed in" here, the same as it
      // did when the app read `authClient.useSession()`.
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
      const response = await fetchJson<{ households: HouseholdSummary[] }>(
        "/api/settings/households",
      );
      return { households: response.households, error: null };
    } catch (error) {
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
