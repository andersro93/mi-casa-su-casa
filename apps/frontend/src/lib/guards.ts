/**
 * `beforeLoad` guards. Everything the pre-router `App.tsx` did with effects
 * and `<Navigate>` — check first-run setup, require a session, resolve the
 * household in the URL, keep members out of owner-only views — happens here,
 * before a screen mounts.
 *
 * The guards read through the TanStack Query cache (`lib/session.ts`) so a
 * navigation whose data is already cached resolves *synchronously*: the
 * helpers below deliberately avoid `async` and only return a promise when
 * something actually has to be fetched. That is what keeps the full-screen
 * "Loading your shared inbox…" state to the first load, exactly as before,
 * even with `defaultPendingMs: 0`.
 */
import type {
  FetchQueryOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { type ParsedLocation, redirect } from "@tanstack/react-router";
import type { HouseholdSummary, SessionData } from "../types";
import { SessionUnavailableError } from "./auth-client";
import {
  ANONYMOUS_SESSION,
  householdsQueryOptions,
  isAuthenticated,
  PENDING_INVITE_KEY,
  type SessionResult,
  type SetupStatusResult,
  sessionQueryOptions,
  setupStatusQueryOptions,
} from "./session";

export interface RouterContext {
  queryClient: QueryClient;
}

/** The subset of TanStack's `beforeLoad` argument these guards need. */
export interface GuardArgs {
  context: RouterContext;
  location: ParsedLocation;
}

type Maybe<T> = T | Promise<T>;

/**
 * Fresh cached value (synchronously) when there is one, a fetch when there
 * isn't. Invalidated entries always refetch — that is how a sign-in or a
 * sign-out reaches the guards that ran a moment earlier with the old answer.
 */
function read<T, TKey extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<T, Error, T, TKey>,
): Maybe<T> {
  const state = queryClient.getQueryState<T>(options.queryKey);
  const staleTime =
    typeof options.staleTime === "number" ? options.staleTime : 0;
  const fresh =
    state !== undefined &&
    state.data !== undefined &&
    !state.isInvalidated &&
    Date.now() - state.dataUpdatedAt < staleTime;

  return fresh ? (state.data as T) : queryClient.fetchQuery(options);
}

/** `.then` that stays synchronous for values that are not promises. */
function then<T, R>(value: Maybe<T>, next: (value: T) => Maybe<R>): Maybe<R> {
  return value instanceof Promise ? value.then(next) : next(value);
}

/**
 * The session, read with the one rule that separates it from every other
 * query here: **only a definitive 401 means signed out.**
 *
 * `sessionQueryOptions` rejects with `SessionUnavailableError` when the check
 * could not be made at all — a 429 from Limen's 60/min limiter, a 5xx, a
 * dropped connection, a deadline (`lib/session.ts`). When that happens:
 *
 *  - a previously cached answer is used and the navigation carries on. The
 *    visitor is still signed in; the server just could not say so this
 *    second, and bouncing them to `/login` over that is the bug this exists
 *    to prevent.
 *  - with nothing cached there is nothing honest to say. `whenUnavailable`
 *    decides: the public routes settle for "anonymous" so sign-in stays
 *    reachable during an outage, while the authed ones pass `null` and let
 *    the error escape to the router's error screen, which offers a retry.
 *
 * Retries are for *finding out*, so they are switched off whenever the cache
 * already holds an answer. Otherwise a 429 incident would make every single
 * navigation sit through the backoff and spend three requests out of the
 * sixty per minute that caused the 429 — paying, on the critical path, for
 * information the guard is about to discard in favour of the cache. With
 * nothing cached the retries are the whole point and stay on.
 *
 * A cached answer is never a licence to ignore the server: the fetch is still
 * awaited, so a session revoked elsewhere still answers 401 and still lands
 * the visitor on `/login`. This is only about what to do when the server does
 * not answer at all.
 */
function readSession(
  queryClient: QueryClient,
  whenUnavailable: SessionResult | null,
): Maybe<SessionResult> {
  const cached = queryClient.getQueryData<SessionResult>(
    sessionQueryOptions.queryKey,
  );

  const value = read(
    queryClient,
    cached === undefined
      ? sessionQueryOptions
      : { ...sessionQueryOptions, retry: false },
  );
  if (!(value instanceof Promise)) return value;

  return value.catch((error: unknown) => {
    // Only a check that could not be made is recoverable here. Anything else
    // is a bug in the query function and must not be papered over with a
    // stale session.
    if (!(error instanceof SessionUnavailableError)) throw error;

    // Re-read: the fetch may have been in flight long enough for the answer
    // to have changed underneath the value read above.
    const previous = queryClient.getQueryData<SessionResult>(
      sessionQueryOptions.queryKey,
    );

    if (previous) {
      // Write it back, unchanged, to re-date it. That is not bookkeeping: a
      // single navigation runs this guard once per matched route, and a
      // failed fetch leaves the entry invalidated, so without this every
      // route in the chain re-asks a server that has just refused — turning
      // one 429 into several. Re-dating says "this is the answer we are
      // going with", and it holds for the same `staleTime` a successful
      // check would have earned. An explicit `invalidateQueries` (sign-in,
      // sign-out, an accepted invitation) still forces a fresh check.
      queryClient.setQueryData(sessionQueryOptions.queryKey, previous);
      return previous;
    }

    // Nothing cached: do not seed `whenUnavailable`. It is this guard's
    // decision about one navigation, not an answer about the account, and
    // caching it would keep a signed-in visitor on `/login` for 30 seconds.
    if (whenUnavailable) return whenUnavailable;
    throw error;
  });
}

function pendingInviteToken(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

/**
 * Account settings and household settings were the two views the old app let
 * you reach with an invite still pending — bouncing someone out of the page
 * they just opened would be worse than finishing the invite later.
 */
function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.endsWith("/settings");
}

function honourPendingInvite(location: ParsedLocation): void {
  if (isSettingsPath(location.pathname)) return;

  const token = pendingInviteToken();
  if (!token) return;

  throw redirect({ to: "/invite/$token", params: { token }, replace: true });
}

/**
 * `?redirect=` is attacker-controllable — it is whatever was in the URL when
 * the visitor hit `/login`. Only an absolute path within this app is followed;
 * anything that a browser would resolve to another origin ("//evil.example",
 * "/\\evil.example", "https://evil.example") is dropped and the caller falls
 * back to `/`.
 */
export function safeRedirect(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

/** Where a signed-in visitor with no route of their own belongs. */
export function householdStart(households: HouseholdSummary[]) {
  const first = households[0];
  return first
    ? ({ to: "/$slug/inbox", params: { slug: first.slug } } as const)
    : ({ to: "/new-household" } as const);
}

/**
 * First-run setup wins over everything else: an unconfigured deployment has
 * no accounts to sign in with.
 */
export function requireSetupDone({
  context,
  location,
}: GuardArgs): Maybe<SetupStatusResult> {
  return then(read(context.queryClient, setupStatusQueryOptions), (setup) => {
    if (setup.status?.needsSetup && location.pathname !== "/setup") {
      throw redirect({ to: "/setup", replace: true });
    }
    return setup;
  });
}

/** `/setup` itself: only reachable while the deployment still needs it. */
export function requireSetupPending(args: GuardArgs): Maybe<SetupStatusResult> {
  return then(
    read(args.context.queryClient, setupStatusQueryOptions),
    (setup) => {
      if (setup.status && !setup.status.needsSetup) {
        throw redirect({ to: "/", replace: true });
      }
      return setup;
    },
  );
}

export interface SessionGuardResult {
  setup: SetupStatusResult;
  session: SessionData;
}

/**
 * Signed-in visitors only. Anonymous ones go to `/login` with the route they
 * asked for preserved in `?redirect=`, so signing in lands them there.
 */
export function requireSession(args: GuardArgs): Maybe<SessionGuardResult> {
  return then(requireSetupDone(args), (setup) =>
    // No fallback: with nothing cached, a session check that could not be
    // made must reach the error screen and its retry, never `/login`.
    then(readSession(args.context.queryClient, null), (session) => {
      if (!isAuthenticated(session)) {
        throw redirect({
          to: "/login",
          search: { redirect: args.location.href },
          replace: true,
        });
      }
      return { setup, session: { user: session.user } };
    }),
  );
}

/** `/login` and friends: a signed-in visitor has no business here. */
export function requireAnonymous(args: GuardArgs): Maybe<SetupStatusResult> {
  return then(requireSetupDone(args), (setup) =>
    // Falls back to "anonymous": if we cannot find out who this is, the way
    // *in* has to stay open. Showing the sign-in page to someone who turns
    // out to be signed in costs them a click; an error screen in front of
    // sign-in during an outage costs them the app.
    then(
      readSession(args.context.queryClient, ANONYMOUS_SESSION),
      (session) => {
        if (isAuthenticated(session)) {
          throw redirect({ to: "/", replace: true });
        }
        return setup;
      },
    ),
  );
}

export interface ChromeGuardResult extends SessionGuardResult {
  households: HouseholdSummary[];
}

export interface HouseholdGuardResult extends ChromeGuardResult {
  household: HouseholdSummary;
}

/**
 * The authed chrome: a session, plus the household list the sidebar and the
 * switcher are drawn from. The list is ensured *here* rather than fetched by
 * the chrome as it renders, because otherwise a cold load of `/settings` or
 * `/new-household` — the two authed routes with no slug to guard — paints the
 * page with no chrome around it for one round trip.
 */
export function requireChrome(args: GuardArgs): Maybe<ChromeGuardResult> {
  return then(requireSession(args), (base) =>
    then(
      read(args.context.queryClient, householdsQueryOptions),
      ({ households }) => ({ ...base, households }),
    ),
  );
}

/**
 * The `/$slug` shell: the slug has to name a household this account is a
 * member of. An unknown slug is a stale bookmark or a household they have
 * left — send them to the one they do have rather than showing an error.
 */
export function requireHousehold(
  args: GuardArgs,
  slug: string,
): Maybe<HouseholdGuardResult> {
  return then(requireChrome(args), (base) => {
    honourPendingInvite(args.location);

    const household = base.households.find((entry) => entry.slug === slug);
    if (!household) {
      throw redirect({ ...householdStart(base.households), replace: true });
    }

    return { ...base, household };
  });
}

/** Members see the inbox; the rest of a household's views are the owner's. */
export function requireOwner(
  args: GuardArgs,
  slug: string,
): Maybe<HouseholdGuardResult> {
  return then(requireHousehold(args, slug), (result) => {
    if (result.household.role !== "owner") {
      throw redirect({
        to: "/$slug/inbox",
        params: { slug: result.household.slug },
        replace: true,
      });
    }
    return result;
  });
}

/**
 * `/` and the catch-all: work out where this visitor actually belongs —
 * setup, sign-in, a pending invitation, their first household's inbox, or
 * the create-household screen.
 */
export function redirectToStart(args: GuardArgs): Maybe<never> {
  return then(requireSession(args), () =>
    then(
      read(args.context.queryClient, householdsQueryOptions),
      ({ households }) => {
        honourPendingInvite(args.location);

        // `/casa` (a real household, no view) should land on that household's
        // inbox, not on whichever household happens to be first.
        const segment = args.location.pathname.split("/").filter(Boolean)[0];
        const named = households.find((entry) => entry.slug === segment);
        if (named) {
          throw redirect({
            to: "/$slug/inbox",
            params: { slug: named.slug },
            replace: true,
          });
        }

        throw redirect({ ...householdStart(households), replace: true });
      },
    ),
  );
}
