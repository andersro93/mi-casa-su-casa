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
  // What POST /api/invitations/accept answers. Defaults to the happy path;
  // the failure cases pass an error envelope and its status.
  accept: { body: unknown; status: number } = {
    body: { household: { slug: "olsen" } },
    status: 200,
  },
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
        return json(accept.body, accept.status);
      }
      return json({ error: "unhandled" }, 404);
    }),
  );
  return calls;
}

/** Fills the sign-up form and submits it, for the accept-failure cases. */
async function submitSignUp() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Your name/), "Kari Olsen");
  await user.type(
    screen.getByLabelText(/Choose a password/),
    "correct-horse-battery",
  );
  await user.click(
    screen.getByRole("button", { name: "Create account and join" }),
  );
}

describe("InvitePage", () => {
  beforeEach(() => {
    // `mockClear` + an explicit default, not `mockReset`: under Vitest 4 a
    // mock that has been reset reports a *caught* rejection from a later call
    // as a test failure, which makes the refused-sign-out case below
    // untestable. Clearing the calls and re-stating the happy-path
    // implementation gives the same isolation without that.
    signOut.mockClear();
    signOut.mockResolvedValue(undefined);
  });
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

  it("still reloads the invitation when signout is refused", async () => {
    // Limen's /signout is a protected route and throws on any non-2xx — a
    // session that expired while this page sat open answers 401. The reload
    // is what actually settles who the viewer is, so it has to run either
    // way, and the rejection must not surface on the page.
    const calls = mockLookup({
      viewer: { email: "jonas@example.com", emailMatches: false },
    });
    signOut.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );
    renderClient(<InvitePage token="t" onAcceptSuccess={vi.fn()} />, {
      initialEntries: ["/invite/t"],
    });

    await screen.findByRole("heading", { level: 1, name: /different account/ });
    const before = calls.filter((c) => c.url.endsWith("/lookup")).length;
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign out and continue" }));

    await waitFor(() =>
      expect(
        calls.filter((c) => c.url.endsWith("/lookup")).length,
      ).toBeGreaterThan(before),
    );
    expect(screen.queryByText(/Unauthorized/)).toBeNull();
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

  it("sends someone who already has an account to sign in, on the code", async () => {
    mockLookup({}, 200, {
      body: {
        error:
          "An account with the invited email already exists. Sign in with it, then open the invitation link again.",
        code: "ACCOUNT_EXISTS",
      },
      status: 409,
    });
    renderClient(<InvitePage token="t" onAcceptSuccess={vi.fn()} />, {
      initialEntries: ["/invite/t"],
    });

    await submitSignUp();

    expect(
      await screen.findByRole("heading", { level: 1, name: /Welcome back/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in to accept" }),
    ).toBeInTheDocument();
  });

  it("keeps an unrelated 409 on the form, however it is worded", async () => {
    // The generic unique-violation body is a 409 whose text says "already
    // exists" but carries no ACCOUNT_EXISTS code. Branching on the message
    // would wrongly offer "sign in instead" here.
    mockLookup({}, 200, {
      body: { error: "A record with the same token hash already exists" },
      status: 409,
    });
    renderClient(<InvitePage token="t" onAcceptSuccess={vi.fn()} />, {
      initialEntries: ["/invite/t"],
    });

    await submitSignUp();

    expect(
      await screen.findByText(
        "A record with the same token hash already exists",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign in to accept" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create account and join" }),
    ).toBeInTheDocument();
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
