// @vitest-environment jsdom
/**
 * What the router does when the session lookup *fails* rather than answering.
 *
 * `GET /api/auth/me` sits behind Limen's 60/min-per-client limiter, so a busy
 * tab, a shared NAT or a burst of navigations can get a 429 — and a restart,
 * a proxy hiccup or a flaky connection can get a 5xx or nothing at all. None
 * of those mean "signed out": only a definitive 401 does. These tests pin
 * that distinction, and pin the number of `/me` requests a cold load makes.
 */
import "@testing-library/jest-dom/vitest";

import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_RETRY_COUNT, sessionQueryOptions } from "../src/lib/session";
import type { HouseholdSummary, SessionData } from "../src/types";
import { readRequest } from "./fetch-mock";

const authState = vi.hoisted(() => ({
  session: null as SessionData | null,
  /** Set to make the lookup fail the way a 429 or a 5xx does. */
  failure: null as Error | null,
  /** How many of the next lookups `failure` applies to. */
  failuresLeft: Number.POSITIVE_INFINITY,
  calls: 0,
}));

vi.mock("@/lib/auth-client", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/auth-client")>(
    "../src/lib/auth-client",
  );
  return {
    ...actual,
    getSession: async () => {
      authState.calls += 1;
      if (authState.failure !== null && authState.failuresLeft > 0) {
        authState.failuresLeft -= 1;
        throw authState.failure;
      }
      return authState.session;
    },
    signIn: async () => ({ twoFactorRequired: false }),
    signOut: async () => {},
  };
});

const { SessionUnavailableError } = await import("../src/lib/auth-client");
const { createAppRouter } = await import("../src/router");

const owner: HouseholdSummary = {
  id: "h1",
  slug: "casa",
  displayName: "Casa",
  role: "owner",
};

const signedIn: SessionData = {
  user: { email: "alex@example.com", name: "Alex" },
};

/** What Limen's limiter answers with once the 60/min budget is spent. */
function rateLimited() {
  return new SessionUnavailableError("Too many requests", 429, null);
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockApi({
  households = [owner],
}: {
  households?: HouseholdSummary[];
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const { url } = await readRequest(input);

      if (url.includes("/api/setup/status")) {
        return json({
          needsSetup: false,
          setupLocked: false,
          isConfigured: true,
          status: "complete",
          emailDomain: "example.com",
        });
      }
      if (url.includes("/api/settings/households")) return json({ households });

      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

/** Retries are the query's own business here, so the client must not veto them. */
function testQueryClient() {
  return new QueryClient();
}

function routerAt(path: string, queryClient: QueryClient) {
  return createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

/**
 * Staying off `/login` is only half the answer: a guard that *threw* also
 * leaves the URL alone, and puts the error screen where the page should be.
 * This is how the tests tell "carried on" apart from "gave up in place".
 */
function guardError(
  router: ReturnType<typeof routerAt>,
): { message?: string } | null {
  const failed = router.state.matches.find((match) => match.status === "error");
  return (failed?.error as { message?: string } | undefined) ?? null;
}

beforeEach(() => {
  authState.session = null;
  authState.failure = null;
  authState.failuresLeft = Number.POSITIVE_INFINITY;
  authState.calls = 0;
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a failing session lookup is not a sign-out", () => {
  it("keeps a signed-in visitor on the inbox when /me answers 429", async () => {
    authState.session = signedIn;
    mockApi();

    const queryClient = testQueryClient();
    const warmUp = routerAt("/casa/inbox", queryClient);
    await warmUp.load();
    expect(warmUp.state.location.pathname).toBe("/casa/inbox");

    // Everything the guards need is cached now — and stale, so the next
    // navigation re-reads it and meets the limiter.
    authState.failure = rateLimited();
    await queryClient.invalidateQueries({
      queryKey: sessionQueryOptions.queryKey,
    });

    const router = routerAt("/casa/inbox", queryClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/casa/inbox");
    expect(router.state.location.search).not.toMatchObject({
      redirect: expect.anything(),
    });
    // The screen renders: the guard used the session it already had.
    expect(guardError(router)).toBeNull();
    // The last known answer survives the failure; it is not overwritten with
    // "anonymous".
    expect(queryClient.getQueryData(sessionQueryOptions.queryKey)).toEqual({
      status: "signed-in",
      user: signedIn.user,
    });
  });

  it("keeps a signed-in visitor in place when the whole app revalidates into a 429", async () => {
    authState.session = signedIn;
    mockApi();

    const queryClient = testQueryClient();
    const router = routerAt("/casa/members", queryClient);
    await router.load();
    expect(router.state.location.pathname).toBe("/casa/members");

    authState.failure = rateLimited();
    await queryClient.invalidateQueries({
      queryKey: sessionQueryOptions.queryKey,
    });
    await router.invalidate();

    expect(router.state.location.pathname).toBe("/casa/members");
    expect(guardError(router)).toBeNull();
  });

  it("does not sign anyone out over a 5xx or a dead network", async () => {
    authState.session = signedIn;
    mockApi();

    const queryClient = testQueryClient();
    const warmUp = routerAt("/casa/inbox", queryClient);
    await warmUp.load();

    for (const failure of [
      new SessionUnavailableError("Bad gateway", 502, null),
      new SessionUnavailableError("Failed to fetch", 0, null),
    ]) {
      authState.failure = failure;
      await queryClient.invalidateQueries({
        queryKey: sessionQueryOptions.queryKey,
      });

      const router = routerAt("/casa/inbox", queryClient);
      await router.load();
      expect(router.state.location.pathname).toBe("/casa/inbox");
      expect(guardError(router)).toBeNull();
    }
  });

  it("shows an error with a retry — not /login — when a 429 meets a cold cache", async () => {
    authState.failure = rateLimited();
    mockApi();

    const queryClient = testQueryClient();
    const router = routerAt("/casa/inbox", queryClient);
    await router.load();

    // The one thing that must not happen: a visitor with a perfectly valid
    // session bounced to sign in because the server was busy.
    expect(router.state.location.pathname).toBe("/casa/inbox");
    // Nothing was known, so the guard stopped rather than guessing.
    expect(guardError(router)).not.toBeNull();
    // It retried before giving up.
    expect(authState.calls).toBe(1 + SESSION_RETRY_COUNT);

    render(<RouterProvider router={router} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t check|sign|session/i);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("still sends a genuinely signed-out visitor to /login", async () => {
    authState.session = null;
    mockApi();

    const queryClient = testQueryClient();
    const router = routerAt("/casa/inbox", queryClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toMatchObject({
      redirect: "/casa/inbox",
    });
    expect(queryClient.getQueryData(sessionQueryOptions.queryKey)).toEqual({
      status: "anonymous",
      user: null,
    });
  });

  it("lets a visitor reach /login while the session lookup is failing", async () => {
    // The way out of an outage must stay open: nothing is known about this
    // visitor, so the public page renders rather than an error screen.
    authState.failure = rateLimited();
    mockApi();

    const queryClient = testQueryClient();
    const router = routerAt("/login", queryClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/login");
    // And the sign-in form itself, not an error screen in front of it.
    expect(guardError(router)).toBeNull();
  });

  it("retries a 429 and recovers without the visitor seeing it", async () => {
    // One 429, then the real answer — from a cold cache, so the retry is the
    // only thing standing between this visitor and a wrongful /login.
    mockApi();
    authState.session = signedIn;
    authState.failure = rateLimited();
    authState.failuresLeft = 1;

    const queryClient = testQueryClient();
    const router = routerAt("/casa/inbox", queryClient);
    await router.load();

    expect(router.state.location.pathname).toBe("/casa/inbox");
    expect(guardError(router)).toBeNull();
    expect(authState.calls).toBe(2);
  });
});

describe("session retry policy", () => {
  it("retries an unavailable lookup twice and never retries a definitive answer", () => {
    const { retry } = sessionQueryOptions;
    if (typeof retry !== "function")
      throw new Error("expected a retry predicate");

    const unavailable = rateLimited();
    expect(retry(0, unavailable)).toBe(true);
    expect(retry(SESSION_RETRY_COUNT - 1, unavailable)).toBe(true);
    expect(retry(SESSION_RETRY_COUNT, unavailable)).toBe(false);
    // A programming error in the query function must surface at once.
    expect(retry(0, new TypeError("boom"))).toBe(false);
  });

  it("waits for Retry-After when the server sent one", () => {
    const { retryDelay } = sessionQueryOptions;
    if (typeof retryDelay !== "function") {
      throw new Error("expected a retryDelay function");
    }

    const withHeader = new SessionUnavailableError("Too many", 429, 3_000);
    expect(retryDelay(0, withHeader)).toBe(3_000);
    // Backoff otherwise, and it grows.
    const plain = rateLimited();
    expect(retryDelay(1, plain)).toBeGreaterThan(retryDelay(0, plain));
  });
});

describe("how often a cold load asks who is signed in", () => {
  it("asks once", async () => {
    authState.session = signedIn;
    mockApi();

    const queryClient = testQueryClient();
    const router = routerAt("/casa/inbox", queryClient);
    await router.load();
    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/casa/inbox"),
    );

    expect(authState.calls).toBe(1);
  });
});

describe("the session request itself", () => {
  it("sends exactly one GET /api/auth/me per lookup", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const { url } = await readRequest(input);
        calls.push(url);
        return json({ user: { email: "alex@example.com" } });
      }),
    );

    // The real module, imported *after* the stub is in place and with a
    // fresh registry — a genuinely cold page load. That matters: the SDK
    // captures `globalThis.fetch` when its client is constructed, and its
    // session store fires its extra request only on the first mount.
    vi.resetModules();
    const actual = await vi.importActual<
      typeof import("../src/lib/auth-client")
    >("../src/lib/auth-client");

    await expect(actual.getSession()).resolves.toEqual({
      user: { email: "alex@example.com" },
    });
    // A second request fired *after* the first resolves is exactly the bug.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.filter((url) => url.endsWith("/api/auth/me"))).toHaveLength(1);
  });

  it("reports 401 as anonymous and everything else as unavailable", async () => {
    const responses = new Map<number, Response | null>();
    let status = 401;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = responses.get(status);
        if (body === null) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ message: "nope" }), {
          status,
          headers: { "content-type": "application/json", "retry-after": "2" },
        });
      }),
    );
    responses.set(401, new Response());
    responses.set(429, new Response());
    responses.set(503, new Response());
    responses.set(0, null);

    vi.resetModules();
    const actual = await vi.importActual<
      typeof import("../src/lib/auth-client")
    >("../src/lib/auth-client");

    status = 401;
    await expect(actual.getSession()).resolves.toBeNull();

    for (const failing of [429, 503, 0]) {
      status = failing;
      const error = await actual.getSession().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(actual.SessionUnavailableError);
      expect(
        (error as InstanceType<typeof actual.SessionUnavailableError>).status,
      ).toBe(failing);
    }

    status = 429;
    const rateLimit = await actual.getSession().catch((e: unknown) => e);
    expect(
      (rateLimit as InstanceType<typeof actual.SessionUnavailableError>)
        .retryAfterMs,
    ).toBe(2_000);
  });
});
