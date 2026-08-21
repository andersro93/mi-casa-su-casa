// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InboxPage } from "../src/client/components/inbox/InboxPage";
import type { InboxMessage, ProviderSummary } from "../src/client/types";
import {
  renderClient,
  screen,
  userEvent,
  waitFor,
  within,
} from "./client-test-utils";

const providers: ProviderSummary[] = [
  {
    provider_key: "netflix",
    display_name: "Netflix",
    message_count: 2,
    new_count: 1,
    latest_received_at: "2026-08-21T10:44:00.000Z",
    latest_message_id: "m1",
    latest_subject: "Your Netflix verification code",
    latest_code: "482913",
    latest_status: "new",
  },
  {
    provider_key: "spotify",
    display_name: "Spotify",
    message_count: 0,
    new_count: 0,
    latest_received_at: null,
    latest_message_id: null,
    latest_subject: null,
    latest_code: null,
    latest_status: null,
  },
];

const netflixMessages: InboxMessage[] = [
  {
    id: "m1",
    provider_key: "netflix",
    provider_display_name: "Netflix",
    subject: "Your Netflix verification code",
    from_header: "Netflix <info@account.netflix.com>",
    text_body: "Here is your code: 482913",
    extracted_code: "482913",
    status: "new",
    received_at: "2026-08-21T10:44:00.000Z",
  },
  {
    id: "m2",
    provider_key: "netflix",
    provider_display_name: "Netflix",
    subject: "New sign-in",
    from_header: "Netflix <info@account.netflix.com>",
    text_body: "We noticed a new sign-in.",
    extracted_code: null,
    status: "used",
    received_at: "2026-08-20T09:00:00.000Z",
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi({
  summaries = providers,
  failProviders = false,
}: {
  summaries?: ProviderSummary[];
  failProviders?: boolean;
} = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body as string | undefined });
      if (url.endsWith("/api/inbox/olsen/providers")) {
        if (failProviders) return jsonResponse({ error: "Boom" }, 500);
        return jsonResponse({ providers: summaries });
      }
      if (url.includes("/api/inbox/olsen/providers/netflix")) {
        return jsonResponse({
          provider: { providerKey: "netflix", displayName: "Netflix" },
          messages: netflixMessages,
          page: { limit: 50, nextBefore: null },
        });
      }
      if (url.includes("/api/inbox/olsen/providers/spotify")) {
        return jsonResponse({
          provider: { providerKey: "spotify", displayName: "Spotify" },
          messages: [],
          page: { limit: 50, nextBefore: null },
        });
      }
      if (url.includes("/status") && method === "PATCH") {
        const { status } = JSON.parse(init?.body as string) as {
          status: string;
        };
        return jsonResponse({ message: { ...netflixMessages[0], status } });
      }
      return jsonResponse({ error: `Unhandled ${method} ${url}` }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function setViewport(matches: boolean) {
  // `useMediaQuery(theme.breakpoints.up("md"))` → desktop when matches.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("min-width") ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderInbox(path = "/olsen/inbox") {
  // Same route shape as App.tsx so useParams() sees :providerKey.
  const page = (
    <InboxPage slug="olsen" householdName="Familien Olsen" isOwner />
  );
  return renderClient(
    <Routes>
      <Route path="/:slug/inbox" element={page} />
      <Route path="/:slug/inbox/:providerKey" element={page} />
    </Routes>,
    { initialEntries: [path] },
  );
}

describe("InboxPage", () => {
  beforeEach(() => {
    setViewport(false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("phone: shows each service with its latest code and a copy button, no taps needed", async () => {
    mockApi();
    renderInbox();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Latest codes" }),
    ).toBeInTheDocument();
    const netflix = await screen.findByRole("heading", {
      level: 2,
      name: "Netflix",
    });
    expect(netflix).toBeInTheDocument();
    expect(screen.getByText("482 913")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Netflix code" }),
    ).toBeInTheDocument();
    // A service without messages says so instead of showing an empty code.
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
    expect(screen.getByText("Familien Olsen")).toBeInTheDocument();
  });

  it("phone: copying the latest code marks that message as used", async () => {
    const { calls } = mockApi();
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    renderInbox();

    await user.click(
      await screen.findByRole("button", { name: "Copy Netflix code" }),
    );

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch?.url).toContain("/api/inbox/olsen/messages/m1/status");
      expect(patch?.body).toBe(JSON.stringify({ status: "used" }));
    });
  });

  it("phone: opening a service shows the big latest code, its messages, and a way back", async () => {
    mockApi();
    renderInbox("/olsen/inbox/netflix");

    expect(
      await screen.findByRole("heading", { level: 2, name: "Netflix" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All services/ })).toHaveAttribute(
      "href",
      "/olsen/inbox",
    );
    expect(await screen.findByText("Latest code")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy code" }),
    ).toBeInTheDocument();
    expect(screen.getByText("New sign-in")).toBeInTheDocument();
    expect(screen.getByText(/Received/i)).toBeInTheDocument();
  });

  it("desktop: lists services on the left and opens the first one on the right", async () => {
    setViewport(true);
    mockApi();
    renderInbox();

    const list = await screen.findByRole("list", { name: "Services" });
    expect(within(list).getByRole("link", { name: /Netflix/ })).toHaveAttribute(
      "href",
      "/olsen/inbox/netflix",
    );
    expect(await screen.findByText("Latest code")).toBeInTheDocument();
    // The full email stays collapsed until asked for.
    expect(screen.queryByText(/Here is your code/)).toBeNull();
  });

  it("shows a helpful empty state for an owner with no services", async () => {
    mockApi({ summaries: [] });
    renderInbox();
    expect(await screen.findByText("No services yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Set up services" }),
    ).toHaveAttribute("href", "/olsen/providers");
  });

  it("shows a retryable error when the summaries request fails", async () => {
    const { fetchMock } = mockApi({ failProviders: true });
    renderInbox();
    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    const before = fetchMock.mock.calls.length;
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("offers a manual refresh and reports freshness", async () => {
    mockApi();
    renderInbox();
    await screen.findByRole("heading", { level: 2, name: "Netflix" });
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for new codes now" }),
    ).toBeInTheDocument();
  });
});
