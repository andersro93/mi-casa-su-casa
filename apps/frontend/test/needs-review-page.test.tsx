// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NeedsReviewPage } from "../src/components/review/NeedsReviewPage";
import {
  describeReviewReason,
  suggestService,
} from "../src/components/review/reviewReasons";
import type { ProviderSummary, QuarantineMessage } from "../src/types";
import {
  renderClient,
  screen,
  userEvent,
  waitFor,
  within,
} from "./client-test-utils";
import { readRequest } from "./fetch-mock";

const providers: ProviderSummary[] = [
  {
    provider_key: "netflix",
    display_name: "Netflix",
    message_count: 1,
    new_count: 0,
    latest_received_at: null,
    latest_message_id: null,
    latest_subject: null,
    latest_code: null,
    latest_status: null,
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
const queue: QuarantineMessage[] = [
  {
    id: "q1",
    provider_key: "quarantine",
    provider_display_name: "Quarantine",
    subject: "Your code is 204118",
    from_header: "Netflix <info@mailer.netflix.com>",
    envelope_from: "bounce@mailer.netflix.com",
    text_body: "Your verification code is 204118.",
    extracted_code: "204118",
    status: "new",
    quarantine_reason:
      "No sender rule matched the inbound email within the addressed household.",
    received_at: "2026-08-21T09:00:00.000Z",
  },
  {
    id: "q2",
    provider_key: "quarantine",
    provider_display_name: "Quarantine",
    subject: "Urgent: verify your account",
    from_header: "Apple <security@appie-support.example>",
    envelope_from: "x@appie-support.example",
    text_body: "Click here",
    extracted_code: null,
    status: "new",
    quarantine_reason:
      "Sender x@appie-support.example matched provider apple but sender authentication failed: dmarc=fail.",
    received_at: "2026-08-20T09:00:00.000Z",
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi({
  empty = false,
  fail = false,
}: {
  empty?: boolean;
  fail?: boolean;
} = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method, body } = await readRequest(input, init);
      calls.push({ url, method, body });
      if (url.includes("/api/inbox/olsen/quarantine?")) {
        if (fail) return json({ error: "Down" }, 500);
        return json({
          messages: empty ? [] : queue,
          page: { limit: 50, nextBefore: null },
        });
      }
      if (url.endsWith("/api/inbox/olsen/providers"))
        return json({ providers });
      if (url.endsWith("/api/admin/olsen/providers") && method === "GET") {
        return json({
          providers: [
            {
              id: "p-netflix",
              provider_key: "netflix",
              display_name: "Netflix",
              created_at: "",
              rule_count: 1,
            },
            {
              id: "p-spotify",
              provider_key: "spotify",
              display_name: "Spotify",
              created_at: "",
              rule_count: 0,
            },
          ],
          rules: [],
        });
      }
      if (url.includes("/provider-rules") && method === "POST")
        return json({ rule: {} });
      if (url.includes("/review") && method === "POST")
        return json({ ok: true });
      return json({ error: `unhandled ${method} ${url}` }, 404);
    }),
  );
  return calls;
}

function renderPage() {
  return renderClient(
    <NeedsReviewPage slug="olsen" householdName="Familien Olsen" />,
    { initialEntries: ["/olsen/quarantine"] },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("review reasons", () => {
  it("translates classifier reasons and suggests a service from the sender", () => {
    expect(
      describeReviewReason(
        "No sender rule matched the inbound email within the addressed household.",
      ).label,
    ).toBe("Unknown sender");
    expect(
      describeReviewReason("… sender authentication failed: dmarc=fail.").tone,
    ).toBe("error");
    expect(suggestService(queue[0], providers)?.provider_key).toBe("netflix");
    expect(suggestService(queue[1], providers)).toBeNull();
  });
});

describe("NeedsReviewPage", () => {
  it("explains itself and shows each email with a plain reason, opening in place", async () => {
    mockApi();
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Needs review" }),
    ).toBeInTheDocument();
    const list = await screen.findByRole("list", {
      name: "Emails needing review",
    });
    // Chip + explanation both carry the label; at least the chip is there.
    expect(within(list).getAllByText("Unknown sender").length).toBeGreaterThan(
      0,
    );
    expect(
      within(list).getAllByText("Sender check failed").length,
    ).toBeGreaterThan(0);
    await userEvent
      .setup()
      .click(within(list).getByRole("button", { name: /Your code is 204118/ }));
    expect(
      await within(list).findByText(/No service lists this sender yet/),
    ).toBeVisible();
    expect(
      within(list).getByRole("button", { name: "Copy code" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: "File under a service…" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: "Hide this email" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/quarantine|manual classification|owner tools/i),
    ).toBeNull();
  });

  it("files an email under the suggested service and learns the sender", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    const list = await screen.findByRole("list", {
      name: "Emails needing review",
    });
    await user.click(
      within(list).getByRole("button", { name: /Your code is 204118/ }),
    );
    await user.click(
      await within(list).findByRole("button", {
        name: "File under a service…",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "File under a service",
    });
    expect(await within(dialog).findByRole("combobox")).toHaveTextContent(
      "Netflix (suggested)",
    );
    expect(within(dialog).getByRole("checkbox")).toBeChecked();
    await user.click(
      within(dialog).getByRole("button", { name: "File email" }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/quarantine/q1/review"))).toBe(
        true,
      ),
    );
    const rule = calls.find(
      (c) => c.url.endsWith("/provider-rules") && c.method === "POST",
    );
    expect(JSON.parse(rule?.body ?? "{}")).toEqual({
      providerId: "p-netflix",
      matchType: "domain",
      matchValue: "mailer.netflix.com",
    });
    const review = calls.find((c) => c.url.endsWith("/quarantine/q1/review"));
    expect(JSON.parse(review?.body ?? "{}")).toEqual({
      action: "release",
      providerKey: "netflix",
    });
  });

  it("hides an email after explaining what that means", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    const list = await screen.findByRole("list", {
      name: "Emails needing review",
    });
    await user.click(
      within(list).getByRole("button", { name: /Urgent: verify/ }),
    );
    await user.click(
      await within(list).findByRole("button", { name: "Hide this email" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Hide this email?",
    });
    expect(
      within(dialog).getByText(/deleted with the rest of the mail/),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Hide email" }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/quarantine/q2/review"))).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        calls.find((c) => c.url.endsWith("/quarantine/q2/review"))?.body ??
          "{}",
      ),
    ).toEqual({ action: "dismiss" });
  });

  it("shows All clear when empty and a retryable error when the request fails", async () => {
    mockApi({ empty: true });
    renderPage();
    expect(await screen.findByText("All clear")).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({ fail: true });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Down");
  });
});
