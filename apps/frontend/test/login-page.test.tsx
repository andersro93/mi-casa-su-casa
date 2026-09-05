// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
const navigate = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
}));
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return { ...actual, useNavigate: () => navigate };
});

import { LoginPage } from "../src/components/LoginPage";
import { renderClient, screen, userEvent, waitFor } from "./client-test-utils";

function renderLogin(onLoginSuccess = vi.fn()) {
  renderClient(
    <LoginPage
      setupStatus={null}
      setupError={null}
      onLoginSuccess={onLoginSuccess}
    />,
    { initialEntries: ["/login"] },
  );
  return { onLoginSuccess };
}

describe("LoginPage", () => {
  beforeEach(() => {
    signIn.mockReset();
    navigate.mockReset();
    signIn.mockResolvedValue({ twoFactorRequired: false });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers email and password only — passkeys are gone", () => {
    renderLogin();
    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /passkey/i })).toBeNull();
  });

  it("validates inline before calling the API", async () => {
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Email address/), "kari@example.com");
    expect(screen.queryByText("Enter your email address.")).toBeNull();
  });

  it("signs in with email + password and supports show/hide", async () => {
    const { onLoginSuccess } = renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Email address/), "kari@example.com");
    const password = screen.getByLabelText(/^Password/);
    await user.type(password, "correct-horse-battery");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith(
      "kari@example.com",
      "correct-horse-battery",
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sends an account with two-step verification on to the challenge page", async () => {
    const { onLoginSuccess } = renderLogin();
    signIn.mockResolvedValue({ twoFactorRequired: true });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Email address/), "kari@example.com");
    await user.type(
      screen.getByLabelText(/^Password/),
      "correct-horse-battery",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/two-factor" }),
    );
    // Not signed in yet: the server revoked the session it had just minted.
    expect(onLoginSuccess).not.toHaveBeenCalled();
  });

  it("shows the server's error for a wrong password", async () => {
    renderLogin();
    signIn.mockRejectedValue(new Error("Invalid email or password"));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Email address/), "kari@example.com");
    await user.type(screen.getByLabelText(/^Password/), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password",
    );
  });
});
