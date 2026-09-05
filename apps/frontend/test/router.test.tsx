// @vitest-environment jsdom
/**
 * The guard matrix. These drive the real route tree over a memory history and
 * assert where the router *ends up* — the questions `App.tsx` used to answer
 * with effects and `<Navigate>`, and the ones most likely to regress.
 */
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HouseholdSummary, SessionData } from "../src/types";

const authState = vi.hoisted(() => ({
  session: null as SessionData | null,
}));

vi.mock("@server/auth/client", () => ({
  authClient: {
    getSession: async () => ({ data: authState.session, error: null }),
    signOut: async () => ({ data: null, error: null }),
    signIn: { email: async () => ({}), passkey: async () => ({}) },
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
  user: { id: "u1", email: "alex@example.com", name: "Alex" },
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
      const url = typeof input === "string" ? input : String(input);

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

/** Load the real route tree at `path` and report where it settled. */
async function landsOn(path: string): Promise<string> {
  const router = createAppRouter({
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  await router.load();
  return router.state.location.pathname;
}

beforeEach(() => {
  authState.session = null;
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
});
