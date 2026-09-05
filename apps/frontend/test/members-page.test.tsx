// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MembersPage } from "../src/components/members/MembersPage";
import type {
  InvitationSummary,
  MemberSummary,
  ProviderOption,
} from "../src/types";
import {
  renderClient,
  screen,
  userEvent,
  waitFor,
  within,
} from "./client-test-utils";

const providers: ProviderOption[] = [
  { id: "p-netflix", provider_key: "netflix", display_name: "Netflix" },
  { id: "p-disney", provider_key: "disney", display_name: "Disney+" },
];
const members: MemberSummary[] = [
  {
    id: "u-anders",
    email: "anders@example.com",
    name: "Anders",
    role: "owner",
    createdAt: "",
    updatedAt: "",
    providerAccess: [],
  },
  {
    id: "u-kari",
    email: "kari@example.com",
    name: "Kari",
    role: "member",
    createdAt: "",
    updatedAt: "",
    providerAccess: [{ providerKey: "netflix", displayName: "Netflix" }],
  },
];
const invitations: InvitationSummary[] = [
  {
    id: "inv-1",
    email: "jonas@example.com",
    name: "Jonas",
    role: "member",
    status: "pending",
    invitedByUserId: "u-anders",
    acceptedByUserId: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    acceptedAt: null,
    cancelledAt: null,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    providers: [],
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi({ emailSent = true }: { emailSent?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body as string | undefined });
      if (url.endsWith("/api/admin/olsen/members") && method === "GET")
        return json({ members, providers });
      if (url.endsWith("/api/admin/olsen/invitations") && method === "GET")
        return json({ invitations });
      if (url.endsWith("/api/admin/olsen/invitations") && method === "POST") {
        const body = JSON.parse(init?.body as string);
        return json(
          {
            invitation: {
              ...invitations[0],
              email: body.email,
              name: body.name,
            },
            inviteUrl: "https://mcsc.example/invite/tok",
            emailSent,
          },
          201,
        );
      }
      if (url.endsWith("/resend"))
        return json({
          invitation: invitations[0],
          inviteUrl: "https://mcsc.example/invite/tok",
          emailSent: true,
        });
      return json({ ok: true });
    }),
  );
  return calls;
}

function renderPage() {
  return renderClient(
    <MembersPage
      slug="olsen"
      householdName="Familien Olsen"
      currentUserId="u-anders"
    />,
    { initialEntries: ["/olsen/members"] },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("MembersPage", () => {
  it("lists members with what they can see, and pending invitations with resend/cancel", async () => {
    mockApi();
    renderPage();
    const list = await screen.findByRole("list", { name: "Members" });
    expect(within(list).getByText("Anders (you)")).toBeInTheDocument();
    expect(within(list).getByText("Can see everything")).toBeInTheDocument();
    expect(within(list).getByText("Can see: Netflix")).toBeInTheDocument();
    const pending = await screen.findByRole("list", {
      name: "Pending invitations",
    });
    expect(within(pending).getByText(/Jonas/)).toBeInTheDocument();
    expect(
      within(pending).getByRole("button", { name: "Resend" }),
    ).toBeInTheDocument();
    expect(
      within(pending).getByRole("button", { name: "Cancel invitation" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/roster|focused flow|dedicated dialog/),
    ).toBeNull();
  });

  it("invites someone with role + services in one flow and confirms the email went out", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Invite someone" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Invite someone",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );
    expect(
      within(dialog).getByText("Enter their email address."),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText(/Email address/),
      "mor@example.com",
    );
    await user.type(within(dialog).getByLabelText(/^Name/), "Mor");
    await user.click(within(dialog).getByRole("checkbox", { name: "Disney+" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url.endsWith("/invitations"),
        ),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/invitations"),
    );
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      email: "mor@example.com",
      name: "Mor",
      role: "member",
      providerIds: ["p-netflix"],
    });
    expect(
      await screen.findByRole("dialog", { name: "Invitation sent" }),
    ).toBeInTheDocument();
  });

  it("hands over a link when the invitation email cannot be sent", async () => {
    mockApi({ emailSent: false });
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Invite someone" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Invite someone",
    });
    await user.type(
      within(dialog).getByLabelText(/Email address/),
      "mor@example.com",
    );
    await user.type(within(dialog).getByLabelText(/^Name/), "Mor");
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );
    const result = await screen.findByRole("dialog", {
      name: "Share this invitation link",
    });
    expect(
      within(result).getByDisplayValue("https://mcsc.example/invite/tok"),
    ).toBeInTheDocument();
    expect(
      within(result).getByRole("button", { name: "Copy link" }),
    ).toBeInTheDocument();
  });

  it("changes what a member can see, saving grants and revokes together", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "Members" });
    await user.click(screen.getByRole("button", { name: "Options for Kari" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Change what they can see" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "What can Kari see?",
    });
    await user.click(within(dialog).getByRole("checkbox", { name: "Netflix" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Disney+" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url.endsWith("/members/u-kari/provider-access"),
        ),
      ).toBe(true);
      expect(
        calls.some(
          (c) =>
            c.method === "DELETE" &&
            c.url.endsWith("/members/u-kari/provider-access/netflix"),
        ),
      ).toBe(true);
    });
  });

  it("confirms role changes and removals, and guards the last owner / yourself", async () => {
    const calls = mockApi();
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("list", { name: "Members" });
    await user.click(
      screen.getByRole("button", { name: "Options for Anders" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Make member" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: "Remove from household" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    await user.click(
      await screen.findByRole("button", { name: "Options for Kari" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Make owner" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Make Kari an owner?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Make owner" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PATCH" && c.url.endsWith("/members/u-kari/role"),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(
      await screen.findByRole("button", { name: "Options for Kari" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Remove from household" }),
    );
    const remove = await screen.findByRole("dialog", { name: "Remove Kari?" });
    await user.click(within(remove).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.url.endsWith("/members/u-kari"),
        ),
      ).toBe(true),
    );
  });
});
