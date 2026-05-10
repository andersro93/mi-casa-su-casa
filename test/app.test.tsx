import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: null as {
    user: {
      email: string;
      role: string;
      name?: string | null;
    };
  } | null,
  isPending: false,
  error: null as { message: string } | null,
}));

const setupStatusState = vi.hoisted(() => ({
  current: {
    needsSetup: false,
    setupLocked: true,
    isConfigured: true,
    status: "complete",
    ownerEmail: null,
  },
}));

const refetchMock = vi.hoisted(() => vi.fn(async () => undefined));
const signInEmailMock = vi.hoisted(() =>
  vi.fn(async () => ({ data: null, error: null })),
);
const signOutMock = vi.hoisted(() =>
  vi.fn(async () => ({ data: null, error: null })),
);

vi.mock("@server/auth/client", () => ({
  authClient: {
    useSession: () => ({
      data: authState.session,
      isPending: authState.isPending,
      error: authState.error,
      refetch: refetchMock,
    }),
    signIn: {
      email: signInEmailMock,
    },
    signOut: signOutMock,
  },
}));

const { App } = await import("../src/client/App");

describe("App", () => {
  beforeEach(() => {
    authState.session = null;
    authState.isPending = false;
    authState.error = null;
    setupStatusState.current = {
      needsSetup: false,
      setupLocked: true,
      isConfigured: true,
      status: "complete",
      ownerEmail: null,
    };
    refetchMock.mockClear();
    signInEmailMock.mockClear();
    signOutMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(setupStatusState.current), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }),
      ),
    );
    vi.stubGlobal("window", {
      location: {
        pathname: "/",
      },
      history: {
        replaceState: vi.fn(),
      },
    } as unknown as Window & typeof globalThis);
  });

  it("renders the invite-only sign-in experience when signed out", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Shared verification inbox, without the chaos.");
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Quarantine review");
  });

  it("renders the first-run setup experience when setup is required", () => {
    setupStatusState.current = {
      needsSetup: true,
      setupLocked: false,
      isConfigured: true,
      status: "pending",
      ownerEmail: null,
    };
    vi.stubGlobal("window", {
      location: {
        pathname: "/setup",
      },
      history: {
        replaceState: vi.fn(),
      },
    } as unknown as Window & typeof globalThis);

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Finish setting up your household inbox.");
    expect(html).toContain("Complete setup");
    expect(html).toContain("SETUP_SECRET");
  });

  it("renders the inbox shell for a signed-in member", () => {
    authState.session = {
      user: {
        email: "member@example.com",
        role: "member",
        name: "Alex",
      },
    };
    authState.isPending = false;
    authState.error = null;

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Welcome back, Alex.");
    expect(html).toContain("Your accessible groups");
    expect(html).toContain("Choose a provider");
    expect(html).not.toContain("Quarantine review");
  });

  it("renders owner-only quarantine tools for admins", () => {
    authState.session = {
      user: {
        email: "owner@example.com",
        role: "admin",
      },
    };
    authState.isPending = false;
    authState.error = null;

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Owner tools");
    expect(html).toContain("Household access");
    expect(html).toContain("Create a household member");
    expect(html).toContain("Quarantine review");
    expect(html).toContain("Release to provider");
  });
});
