// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRequest } from "./fetch-mock";

const auth = vi.hoisted(() => ({
  twoFactor: {
    initiateSetup: vi.fn(),
    finalizeSetup: vi.fn(),
    getBackupCodes: vi.fn(),
    regenerateBackupCodes: vi.fn(),
    disable: vi.fn(),
  },
  password: {
    change: vi.fn(),
    requestReset: vi.fn(),
    reset: vi.fn(),
  },
}));
vi.mock("@/lib/auth-client", () => auth);
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAA"),
  },
}));

import { AccountSettingsPage } from "../src/components/settings/AccountSettingsPage";
import type { AccountSettingsResponse } from "../src/types";
import { describeUserAgent } from "../src/utils";
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

function mockApi({ twoFactorEnabled = false } = {}) {
  const profile = { ...settings.profile, twoFactorEnabled };
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method, body } = await readRequest(input, init);
      calls.push({ url, method, body });
      if (url.endsWith("/api/settings") && method === "GET")
        return json({ ...settings, profile });
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
      auth.twoFactor.initiateSetup,
      auth.twoFactor.finalizeSetup,
      auth.twoFactor.getBackupCodes,
      auth.twoFactor.regenerateBackupCodes,
      auth.twoFactor.disable,
      auth.password.change,
      auth.password.requestReset,
      auth.password.reset,
    ])
      fn.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("groups settings into sections and shows readable devices, with no passkeys", async () => {
    mockApi();
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    for (const name of [
      "Profile",
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
    // Passkeys are gone with Better Auth.
    expect(screen.queryByText(/passkey/i)).toBeNull();
    const devices = screen.getByRole("list", { name: "Signed-in devices" });
    expect(within(devices).getByText("Safari on iPhone")).toBeInTheDocument();
    expect(within(devices).getByText("This device")).toBeInTheDocument();
    expect(within(devices).getByText("Chrome on Windows")).toBeInTheDocument();
    expect(screen.queryByText(/Mozilla\/5\.0/)).toBeNull();
    // `ipAddress` is a keyed digest, not an address: showing it would put an
    // opaque hash where a reader expects something recognisable.
    expect(screen.queryByText(/10\.0\.0\./)).toBeNull();
    expect(screen.queryByText(/Revoke/)).toBeNull();
  });

  it("walks through two-step enrolment and requires saving the backup codes", async () => {
    mockApi();
    // Limen hands over the otpauth URI first and the backup codes only once
    // enrolment has been finished, so the two are separate calls.
    auth.twoFactor.initiateSetup.mockResolvedValue({
      uri: "otpauth://totp/x?secret=ABC123",
    });
    auth.twoFactor.finalizeSetup.mockResolvedValue(undefined);
    auth.twoFactor.getBackupCodes.mockResolvedValue(["1111-2222", "3333-4444"]);
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
    await waitFor(() =>
      expect(auth.twoFactor.finalizeSetup).toHaveBeenCalledWith("123456"),
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

  it("mints a new set of backup codes and warns the old ones are dead", async () => {
    mockApi({ twoFactorEnabled: true });
    auth.twoFactor.regenerateBackupCodes.mockResolvedValue([
      "5555-6666",
      "7777-8888",
    ]);
    renderPage();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "New backup codes" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Your new backup codes",
    });
    expect(
      within(dialog).getByRole("list", { name: "Backup codes" }),
    ).toHaveTextContent("5555-6666");
    expect(within(dialog).getByText(/no longer work/i)).toBeInTheDocument();
  });

  it("changes the password with inline rules and autocomplete hints", async () => {
    mockApi();
    auth.password.change.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    const current = await screen.findByLabelText(/Current password/);
    expect(current).toHaveAttribute("autocomplete", "current-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      screen.getByText("Enter your current password."),
    ).toBeInTheDocument();
    expect(auth.password.change).not.toHaveBeenCalled();
    await user.type(current, "old-password-123");
    await user.type(
      screen.getByLabelText(/New password/),
      "a-much-longer-new-password",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() =>
      expect(auth.password.change).toHaveBeenCalledWith(
        "old-password-123",
        "a-much-longer-new-password",
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
