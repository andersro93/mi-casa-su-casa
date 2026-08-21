// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  passkey: {
    listUserPasskeys: vi.fn(),
    addPasskey: vi.fn(),
    deletePasskey: vi.fn(),
  },
  twoFactor: { enable: vi.fn(), verifyTotp: vi.fn(), disable: vi.fn() },
  changePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
}));
vi.mock("@server/auth/client", () => ({ authClient: auth }));
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAA"),
  },
}));

import { AccountSettingsPage } from "../src/client/components/settings/AccountSettingsPage";
import type { AccountSettingsResponse } from "../src/client/types";
import { describeUserAgent } from "../src/client/utils";
import {
  renderClient,
  screen,
  userEvent,
  waitFor,
  within,
} from "./client-test-utils";

const settings: AccountSettingsResponse = {
  profile: {
    id: "u1",
    email: "kari@example.com",
    name: "Kari",
    image: null,
    role: "user",
    twoFactorEnabled: false,
    households: [
      {
        id: "h1",
        slug: "olsen",
        displayName: "Familien Olsen",
        role: "member",
      },
    ],
  },
  sessions: [
    {
      id: "s1",
      isCurrent: true,
      expiresAt: null,
      ipAddress: "10.0.0.2",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
      impersonatedBy: null,
    },
    {
      id: "s2",
      isCurrent: false,
      expiresAt: null,
      ipAddress: "10.0.0.9",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z",
      impersonatedBy: null,
    },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi() {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body as string | undefined });
      if (url.endsWith("/api/settings") && method === "GET")
        return json(settings);
      return json({ ok: true });
    }),
  );
  return calls;
}

const install = { status: "manual" as const, onInstall: vi.fn() };

function renderPage(onHouseholdLeft = vi.fn()) {
  renderClient(
    <AccountSettingsPage install={install} onHouseholdLeft={onHouseholdLeft} />,
    { initialEntries: ["/settings"] },
  );
  return { onHouseholdLeft };
}

describe("describeUserAgent", () => {
  it("turns user agents into device names", () => {
    expect(describeUserAgent(settings.sessions[0].userAgent)).toBe(
      "Safari on iPhone",
    );
    expect(describeUserAgent(settings.sessions[1].userAgent)).toBe(
      "Chrome on Windows",
    );
    expect(describeUserAgent(null)).toBe("Unknown device");
  });
});

describe("AccountSettingsPage", () => {
  beforeEach(() => {
    for (const fn of [
      auth.passkey.listUserPasskeys,
      auth.passkey.addPasskey,
      auth.passkey.deletePasskey,
      auth.twoFactor.enable,
      auth.twoFactor.verifyTotp,
      auth.twoFactor.disable,
      auth.changePassword,
      auth.requestPasswordReset,
    ])
      fn.mockReset();
    auth.passkey.listUserPasskeys.mockResolvedValue({
      data: [
        { id: "pk1", name: "My iPhone", createdAt: "2026-08-10T00:00:00.000Z" },
      ],
      error: null,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("groups settings into sections, lists passkeys and readable devices", async () => {
    mockApi();
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    for (const name of [
      "Profile",
      "Passkeys",
      "Password",
      "Two-step verification",
      "Signed-in devices",
      "Add to your home screen",
      "Households",
    ]) {
      expect(
        await screen.findByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
    const passkeys = await screen.findByRole("list", { name: "Passkeys" });
    expect(within(passkeys).getByText("My iPhone")).toBeInTheDocument();
    expect(
      within(passkeys).getByRole("button", {
        name: "Remove passkey My iPhone",
      }),
    ).toBeInTheDocument();
    const devices = screen.getByRole("list", { name: "Signed-in devices" });
    expect(within(devices).getByText("Safari on iPhone")).toBeInTheDocument();
    expect(within(devices).getByText("This device")).toBeInTheDocument();
    expect(within(devices).getByText("Chrome on Windows")).toBeInTheDocument();
    expect(screen.queryByText(/Mozilla\/5\.0/)).toBeNull();
    expect(screen.queryByText(/Revoke/)).toBeNull();
  });

  it("adds a passkey with a sensible default name", async () => {
    mockApi();
    auth.passkey.addPasskey.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Add a passkey for this device",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add a passkey" });
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(auth.passkey.addPasskey).toHaveBeenCalledTimes(1),
    );
    expect(auth.passkey.addPasskey.mock.calls[0][0]).toMatchObject({
      name: expect.any(String),
    });
  });

  it("walks through two-step enrolment and requires saving the backup codes", async () => {
    mockApi();
    auth.twoFactor.enable.mockResolvedValue({
      data: {
        totpURI: "otpauth://totp/x?secret=ABC123",
        backupCodes: ["1111-2222", "3333-4444"],
      },
      error: null,
    });
    auth.twoFactor.verifyTotp.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Turn on" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Turn on two-step verification",
    });
    await user.type(
      within(dialog).getByLabelText(/Your password/),
      "correct-horse-battery",
    );
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("ABC123")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/6-digit code/), "123456");
    await user.click(
      within(dialog).getByRole("button", { name: "Verify code" }),
    );
    expect(
      await within(dialog).findByRole("list", { name: "Backup codes" }),
    ).toHaveTextContent("1111-2222");
    expect(
      within(dialog).getByRole("button", { name: "Copy all codes" }),
    ).toBeInTheDocument();
    const done = within(dialog).getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", { name: /I've saved these codes/ }),
    );
    expect(done).toBeEnabled();
  });

  it("changes the password with inline rules and autocomplete hints", async () => {
    mockApi();
    auth.changePassword.mockResolvedValue({ data: {}, error: null });
    renderPage();
    const user = userEvent.setup();
    const current = await screen.findByLabelText(/Current password/);
    expect(current).toHaveAttribute("autocomplete", "current-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      screen.getByText("Enter your current password."),
    ).toBeInTheDocument();
    expect(auth.changePassword).not.toHaveBeenCalled();
    await user.type(current, "old-password-123");
    await user.type(
      screen.getByLabelText(/New password/),
      "a-much-longer-new-password",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() =>
      expect(auth.changePassword).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPassword: "old-password-123",
          newPassword: "a-much-longer-new-password",
        }),
      ),
    );
  });

  it("signs out another device and leaves a household through confirms", async () => {
    const calls = mockApi();
    const { onHouseholdLeft } = renderPage();
    const user = userEvent.setup();
    const devices = await screen.findByRole("list", {
      name: "Signed-in devices",
    });
    await user.click(within(devices).getByRole("button", { name: "Sign out" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Sign out this device?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "DELETE" &&
            c.url.endsWith("/api/settings/sessions/s2"),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(
      within(screen.getByRole("list", { name: "Households" })).getByRole(
        "button",
        { name: "Leave" },
      ),
    );
    const leave = await screen.findByRole("dialog", {
      name: "Leave Familien Olsen?",
    });
    await user.click(
      within(leave).getByRole("button", { name: "Leave household" }),
    );
    await waitFor(() =>
      expect(onHouseholdLeft).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "olsen" }),
      ),
    );
  });
});
