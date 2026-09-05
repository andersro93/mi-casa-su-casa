// @vitest-environment jsdom
/**
 * The guard matrix. These drive the real route tree over a memory history and
 * assert where the router *ends up* — the questions `App.tsx` used to answer
 * with effects and `<Navigate>`, and the ones most likely to regress.
 */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { safeRedirect } from "../src/lib/guards";
import {
  ANONYMOUS_SESSION,
  clearAuthQueries,
  householdsQueryOptions,
  sessionQueryOptions,
  signOutAndReset,
} from "../src/lib/session";
import type { HouseholdSummary, SessionData } from "../src/types";
import { readRequest } from "./fetch-mock";

const authState = vi.hoisted(() => ({
  session: null as SessionData | null,
  /** Set to make `signOut` reject, the way Limen's protected route does. */
  signOutError: null as Error | null,
}));

vi.mock("@/lib/auth-client", () => ({
  getSession: async () => authState.session,
  signIn: async () => ({ twoFactorRequired: false }),
  signOut: async () => {
    if (authState.signOutError) throw authState.signOutError;
  },
}));

const { createAppRouter } = await import("../src/router");

const owner: HouseholdSummary = {
  id: "h1",
  slug: "casa",
  displayName: "Casa",
  role: "owner",
};
const member: HouseholdSummary = { ...owner, role: "member" };

const signedIn: SessionData = {
  user: { email: "alex@example.com", name: "Alex" },
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockApi({
  needsSetup = false,
  households = [] as HouseholdSummary[],
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const { url } = await readRequest(input);

      if (url.includes("/api/setup/status")) {
        return json({
          needsSetup,
          setupLocked: false,
          isConfigured: !needsSetup,
          status: needsSetup ? "pending" : "complete",
          emailDomain: "example.com",
        });
      }

      if (url.includes("/api/settings/households")) {
        return json({ households });
      }

      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function routerAt(path: string, queryClient = testQueryClient()) {
  return createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

/** Load the real route tree at `path` and report where it settled. */
async function landsOn(path: string): Promise<string> {
  const router = routerAt(path);
  await router.load();
  return router.state.location.pathname;
}

beforeEach(() => {
  authState.session = null;
  authState.signOutError = null;
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("route guards", () => {
  it("sends an anonymous visitor from a household view to sign in", async () => {
    mockApi({ households: [owner] });

    expect(await landsOn("/casa/inbox")).toBe("/login");
  });

  it("keeps the requested route in ?redirect= so signing in lands there", async () => {
    mockApi({ households: [owner] });

    const router = createAppRouter({
      queryClient: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
      history: createMemoryHistory({ initialEntries: ["/casa/members"] }),
    });
    await router.load();

    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toMatchObject({
      redirect: "/casa/members",
    });
  });

  it("sends everyone to setup while the deployment still needs it", async () => {
    mockApi({ needsSetup: true });

    expect(await landsOn("/casa/inbox")).toBe("/setup");
    expect(await landsOn("/login")).toBe("/setup");
  });

  it("keeps a member out of the owner-only members view", async () => {
    authState.session = signedIn;
    mockApi({ households: [member] });

    expect(await landsOn("/casa/members")).toBe("/casa/inbox");
  });

  it("lets an owner into the members view", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });

    expect(await landsOn("/casa/members")).toBe("/casa/members");
  });

  it("sends / to the first household's inbox", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });

    expect(await landsOn("/")).toBe("/casa/inbox");
  });

  it("sends / to the create-household screen when there is none", async () => {
    authState.session = signedIn;
    mockApi({ households: [] });

    expect(await landsOn("/")).toBe("/new-household");
  });

  it("sends an unknown household slug to the one the account has", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });

    expect(await landsOn("/nowhere/inbox")).toBe("/casa/inbox");
  });

  it("redirects a stale link through the catch-all", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });

    expect(await landsOn("/casa/old-view/deep")).toBe("/casa/inbox");
  });

  it("finishes a pending invitation before showing the inbox", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });
    sessionStorage.setItem("pendingInviteToken", "tok-123");

    expect(await landsOn("/")).toBe("/invite/tok-123");
  });

  it("sends a signed-in visitor away from the login page", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });

    expect(await landsOn("/login")).toBe("/casa/inbox");
  });

  it("keeps account settings reachable without a household in the URL", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });

    expect(await landsOn("/settings")).toBe("/settings");
  });

  it("has the household list ready before the chrome renders", async () => {
    // /settings and /new-household have no slug to guard, so nothing used to
    // wait for the household list: a cold load painted the page with no
    // sidebar around it until the query landed.
    authState.session = signedIn;
    mockApi({ households: [owner] });

    const queryClient = testQueryClient();
    const router = routerAt("/settings", queryClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/settings");
    expect(queryClient.getQueryData(householdsQueryOptions.queryKey)).toEqual({
      households: [owner],
      error: null,
    });
  });
});

describe("safeRedirect", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirect("/casa/members")).toBe("/casa/members");
    expect(safeRedirect("/casa/inbox?x=1")).toBe("/casa/inbox?x=1");
  });

  it("drops anything a browser would resolve off-origin", () => {
    // ?redirect= is whatever was in the URL when the visitor hit /login, so
    // it is attacker-controllable: these must never be navigated to.
    expect(safeRedirect("//evil.example")).toBeNull();
    expect(safeRedirect("/\\evil.example")).toBeNull();
    expect(safeRedirect("https://evil.example")).toBeNull();
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
    expect(safeRedirect("casa/inbox")).toBeNull();
  });

  it("treats a missing value as no redirect", () => {
    expect(safeRedirect(undefined)).toBeNull();
    expect(safeRedirect("")).toBeNull();
  });
});

describe("the two-factor challenge", () => {
  it("carries ?redirect= so the second half of sign-in lands correctly", async () => {
    mockApi({ households: [owner] });

    const router = routerAt("/two-factor?redirect=%2Fcasa%2Fmembers");
    await router.load();

    expect(router.state.location.pathname).toBe("/two-factor");
    expect(router.state.location.search).toMatchObject({
      redirect: "/casa/members",
    });
  });
});

describe("signing out", () => {
  it("lands on /login without refetching households as a signed-out visitor", async () => {
    authState.session = signedIn;
    mockApi({ households: [owner] });

    const queryClient = testQueryClient();
    const router = routerAt("/casa/inbox", queryClient);
    await router.load();
    expect(router.state.location.pathname).toBe("/casa/inbox");

    // Stand in for the mounted chrome, which observes the households query
    // for as long as it is on screen. Invalidating with this observer live —
    // what the first cut did — refetches a list the visitor is no longer
    // entitled to, draws a 401, and flashes "Unauthorized" over the sign-in
    // screen. Seeding must not make a request at all.
    const observer = new QueryObserver(queryClient, householdsQueryOptions);
    const seen: unknown[] = [];
    const unsubscribe = observer.subscribe((result) => seen.push(result.data));

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    authState.session = null;

    await signOutAndReset(queryClient);

    expect(queryClient.getQueryData(sessionQueryOptions.queryKey)).toEqual(
      ANONYMOUS_SESSION,
    );
    expect(queryClient.getQueryData(householdsQueryOptions.queryKey)).toEqual({
      households: [],
      error: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing the chrome could turn into an error snackbar.
    expect(observer.getCurrentResult().data).toEqual({
      households: [],
      error: null,
    });
    expect(
      seen.every((data) => !(data as { error?: string } | undefined)?.error),
    ).toBe(true);
    unsubscribe();

    await router.navigate({ to: "/login", replace: true });
    await router.invalidate();
    expect(router.state.location.pathname).toBe("/login");

    clearAuthQueries(queryClient);
    expect(
      queryClient.getQueryData(sessionQueryOptions.queryKey),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(householdsQueryOptions.queryKey),
    ).toBeUndefined();
  });

  it("still clears the cache and reaches /login when signout itself is refused", async () => {
    // Limen's /signout is a PROTECTED route and throws on any non-2xx, where
    // Better Auth resolved to `{error}`. A session that expired or was
    // revoked from another device answers 401 — the very case where someone
    // most wants the button to work — and the limiter answers 429. Neither
    // may strand the visitor inside the app, and neither may escape as an
    // unhandled rejection.
    authState.session = signedIn;
    mockApi({ households: [owner] });

    const queryClient = testQueryClient();
    const router = routerAt("/casa/inbox", queryClient);
    await router.load();

    const refused = Object.assign(new Error("Unauthorized"), { status: 401 });
    authState.signOutError = refused;
    authState.session = null;

    await expect(signOutAndReset(queryClient)).resolves.toBeUndefined();

    expect(queryClient.getQueryData(sessionQueryOptions.queryKey)).toEqual(
      ANONYMOUS_SESSION,
    );
    expect(queryClient.getQueryData(householdsQueryOptions.queryKey)).toEqual({
      households: [],
      error: null,
    });

    await router.navigate({ to: "/login", replace: true });
    await router.invalidate();
    expect(router.state.location.pathname).toBe("/login");
  });
});
