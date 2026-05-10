import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@server/auth/client", () => ({
  authClient: {
    useSession: () => ({
      data: authState.session,
      isPending: authState.isPending,
      error: authState.error,
      refetch: vi.fn(async () => undefined),
    }),
    signIn: {
      email: vi.fn(async () => ({ data: null, error: null })),
    },
    signOut: vi.fn(async () => ({ data: null, error: null })),
  },
}));

const { App } = await import("../src/client/App");

describe("App", () => {
  it("renders the invite-only sign-in experience when signed out", () => {
    authState.session = null;
    authState.isPending = false;
    authState.error = null;

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Shared verification inbox, without the chaos.");
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Quarantine review");
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
    expect(html).toContain("Quarantine review");
    expect(html).toContain("Release to provider");
  });
});
