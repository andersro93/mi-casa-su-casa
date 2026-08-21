// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesPage } from "../src/client/components/services/ServicesPage";
import {
  describeSender,
  describeSenderProblem,
  suggestDomainFromName,
} from "../src/client/components/services/senderRules";
import type { ProviderConfiguration, SenderRule } from "../src/client/types";
import {
  renderClient,
  screen,
  userEvent,
  waitFor,
  within,
} from "./client-test-utils";

const providers: ProviderConfiguration[] = [
  {
    id: "p-netflix",
    provider_key: "netflix",
    display_name: "Netflix",
    created_at: "2026-08-01T00:00:00.000Z",
    rule_count: 2,
  },
  {
    id: "p-posten",
    provider_key: "posten",
    display_name: "Posten",
    created_at: "2026-08-02T00:00:00.000Z",
    rule_count: 0,
  },
];
const rules: SenderRule[] = [
  {
    id: "r1",
    provider_id: "p-netflix",
    match_type: "domain",
    match_value: "netflix.com",
    created_at: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "r2",
    provider_id: "p-netflix",
    match_type: "exact",
    match_value: "info@account.netflix.com",
    created_at: "2026-08-01T00:00:00.000Z",
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi({ fail = false }: { fail?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body as string | undefined });
      if (url.endsWith("/api/admin/olsen/providers") && method === "GET") {
        return fail ? json({ error: "Nope" }, 500) : json({ providers, rules });
      }
      if (url.endsWith("/api/admin/olsen/providers") && method === "POST") {
        const body = JSON.parse(init?.body as string);
        return json({
          provider: {
            id: "p-new",
            provider_key: body.providerKey,
            display_name: body.displayName,
            created_at: "",
            rule_count: 0,
          },
        });
      }
      if (
        url.includes("/api/admin/olsen/provider-rules") &&
        method === "POST"
      ) {
        return json({
          rule: { id: "r-new", ...JSON.parse(init?.body as string) },
        });
      }
      if (method === "DELETE" || method === "PATCH") return json({ ok: true });
      return json({ error: `unhandled ${method} ${url}` }, 404);
    }),
  );
  return calls;
}

function renderPage() {
  return renderClient(
    <ServicesPage slug="olsen" householdName="Familien Olsen" />,
    { initialEntries: ["/olsen/providers"] },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("sender helpers", () => {
  it("describes senders and validates values in plain language", () => {
    expect(
      describeSender({ match_type: "domain", match_value: "netflix.com" }),
    ).toBe("netflix.com · any address");
    expect(
      describeSender({ match_type: "exact", match_value: "a@b.com" }),
    ).toBe("a@b.com");
    expect(describeSenderProblem("domain", "netflix.com")).toBeNull();
    expect(describeSenderProblem("domain", "@netflix.com")).toBeNull();
    expect(describeSenderProblem("domain", "info@netflix.com")).toMatch(
      /full address/,
    );
    expect(describeSenderProblem("domain", "")).toMatch(/Enter a domain/);
    expect(describeSenderProblem("exact", "nope")).toMatch(
      /doesn't look like an email/,
    );
    expect(
      describeSenderProblem("exact", "Info@Account.Netflix.com"),
    ).toBeNull();
    expect(suggestDomainFromName("Disney+")).toBe("disney.com");
    expect(suggestDomainFromName("")).toBe("");
  });
});

describe("ServicesPage", () => {
  it("lists services with their senders on the card, plus add/rename/delete on the card", async () => {
    mockApi();
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Services" }),
    ).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Services" });
    const netflix = within(list)
      .getByRole("heading", { level: 2, name: "Netflix" })
      .closest("li") as HTMLElement;
    expect(
      within(netflix).getByText("netflix.com · any address"),
    ).toBeInTheDocument();
    expect(
      within(netflix).getByText("info@account.netflix.com"),
    ).toBeInTheDocument();
    expect(
      within(netflix).getByRole("button", { name: "Add sender" }),
    ).toBeInTheDocument();
    expect(
      within(netflix).getByRole("button", { name: "Options for Netflix" }),
    ).toBeInTheDocument();
    // A service without senders warns where its mail will go.
    expect(screen.getByText(/Until you add a sender/)).toBeInTheDocument();
    expect(
      screen.queryByText(/grid context|service buckets|Provider key/),
    ).toBeNull();
  });

  it("adds a service with its first sender in one step, deriving the key and domain", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Add service" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add a service" });
    await user.type(within(dialog).getByLabelText(/Service name/), "Spotify");
    expect(
      (within(dialog).getByLabelText(/Emails come from/) as HTMLInputElement)
        .value,
    ).toBe("spotify.com");
    expect(
      within(dialog).getByText(/Short name used in links: spotify/),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Add service" }),
    );

    await waitFor(() =>
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(2),
    );
    const [service, sender] = calls.filter((c) => c.method === "POST");
    expect(JSON.parse(service.body ?? "{}")).toEqual({
      providerKey: "spotify",
      displayName: "Spotify",
    });
    expect(JSON.parse(sender.body ?? "{}")).toEqual({
      providerId: "p-new",
      matchType: "domain",
      matchValue: "spotify.com",
    });
    expect(await screen.findByText("Spotify added.")).toBeInTheDocument();
  });

  it("adds a sender to a service with inline validation", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: "Services" });
    const posten = within(list)
      .getByRole("heading", { level: 2, name: "Posten" })
      .closest("li") as HTMLElement;
    await user.click(
      within(posten).getByRole("button", { name: "Add sender" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Add a sender for Posten",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Add sender" }),
    );
    expect(within(dialog).getByText(/Enter a domain/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Domain/), "posten.no");
    await user.click(
      within(dialog).getByRole("button", { name: "Add sender" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url.includes("provider-rules"),
        ),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url.includes("provider-rules"),
    );
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      providerId: "p-posten",
      matchType: "domain",
      matchValue: "posten.no",
    });
  });

  it("removes a sender and deletes a service through confirm dialogs with clear consequences", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "Services" });
    await user.click(screen.getByLabelText("Remove sender netflix.com"));
    const confirm = screen.getByRole("dialog", {
      name: "Stop matching netflix.com?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Remove sender" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.url.endsWith("/provider-rules/r1"),
        ),
      ).toBe(true),
    );

    await user.click(
      await screen.findByRole("button", { name: "Options for Netflix" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete service" }));
    const del = screen.getByRole("dialog", { name: "Delete Netflix?" });
    expect(within(del).getByText(/Needs review/)).toBeInTheDocument();
    await user.click(
      within(del).getByRole("button", { name: "Delete service" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "DELETE" && c.url.endsWith("/providers/p-netflix"),
        ),
      ).toBe(true),
    );
  });

  it("shows a retryable error and a guided empty state", async () => {
    mockApi({ fail: true });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
