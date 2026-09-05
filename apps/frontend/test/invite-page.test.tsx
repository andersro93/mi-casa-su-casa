// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRequest } from "./fetch-mock";

const signOut = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

import { InvitePage } from "../src/components/InvitePage";
import type { InvitationLookupResponse } from "../src/types";
import { renderClient, screen, userEvent, waitFor } from "./client-test-utils";

const base: InvitationLookupResponse = {
  invitation: {
    id: "inv-1",
    email: "kari@example.com",
    name: "Kari",
    role: "member",
    status: "pending",
    invitedByUserId: "u-anders",
    acceptedByUserId: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    acceptedAt: null,
    cancelledAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    providers: [],
  },
  accountExists: false,
  viewer: null,
  household: { displayName: "Familien Olsen" },
  invitedBy: { name: "Anders" },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockLookup(
  response: Partial<InvitationLookupResponse> | { error: string },
  status = 200,
) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method, body } = await readRequest(input, init);
      calls.push({ url, method, body });
      if (url.endsWith("/api/invitations/lookup")) {
        return "error" in response
          ? json(response, status)
          : json({ ...base, ...response });
      }
      if (url.endsWith("/api/invitations/accept")) {
        return json({ household: { slug: "olsen" } });
      }
      return json({ error: "unhandled" }, 404);
    }),
  );
  return calls;
}

describe("InvitePage", () => {
  beforeEach(() => signOut.mockReset());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells a newcomer who invited them, to what, and what the app is", async () => {
    mockLookup({});
    renderClient(<InvitePage token="t" onAcceptSuccess={vi.fn()} />, {
      initialEntries: ["/invite/t"],
    });

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Anders invited you to Familien Olsen",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/login codes for the services it shares/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/As a member you'll see the login codes/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account and join" }),
    ).toBeEnabled();
  });

  it("validates inline instead of disabling the button silently", async () => {
    const calls = mockLookup({});
    const onAcceptSuccess = vi.fn();
    renderClient(<InvitePage token="t" onAcceptSuccess={onAcceptSuccess} />, {
      initialEntries: ["/invite/t"],
    });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", {
      name: "Create account and join",
    });

    await user.click(button);
    expect(screen.getByText("Tell us what to call you.")).toBeInTheDocument();
    expect(screen.getByText(/Use at least 12 characters/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith("/accept"))).toHaveLength(0);

    await user.type(screen.getByLabelText(/Your name/), "Kari Olsen");
    await user.type(screen.getByLabelText(/Choose a password/), "short");
    expect(screen.getByText(/7 more to go/)).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(/Choose a password/),
      "-but-now-long",
    );
    await user.click(button);

    await waitFor(() => expect(onAcceptSuccess).toHaveBeenCalledWith("olsen"));
    const accept = calls.find((c) => c.url.endsWith("/accept"));
    expect(JSON.parse(accept?.body ?? "{}")).toEqual({
      name: "Kari Olsen",
      password: "short-but-now-long",
    });
  });

  it("offers a real sign-out when signed in as the wrong account", async () => {
    mockLookup({ viewer: { email: "jonas@example.com", emailMatches: false } });
    signOut.mockResolvedValue(undefined);
    renderClient(<InvitePage token="t" onAcceptSuccess={vi.fn()} />, {
      initialEntries: ["/invite/t"],
    });

    await screen.findByRole("heading", { level: 1, name: /different account/ });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign out and continue" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("lets the invited person accept directly when already signed in as them", async () => {
    mockLookup({
      viewer: { email: "kari@example.com", emailMatches: true },
      accountExists: true,
    });
    const onAcceptSuccess = vi.fn();
    renderClient(<InvitePage token="t" onAcceptSuccess={onAcceptSuccess} />, {
      initialEntries: ["/invite/t"],
    });

    await screen.findByRole("heading", {
      level: 1,
      name: "Join Familien Olsen",
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(onAcceptSuccess).toHaveBeenCalledWith("olsen"));
  });

  it("explains an expired or used link", async () => {
    mockLookup({ error: "This invitation has expired" }, 410);
    renderClient(<InvitePage token="t" onAcceptSuccess={vi.fn()} />, {
      initialEntries: ["/invite/t"],
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: /isn't available/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("This invitation has expired")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go to sign in" }),
    ).toBeInTheDocument();
  });
});
