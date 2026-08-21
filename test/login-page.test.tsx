// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInEmail = vi.fn();
const signInPasskey = vi.fn();
vi.mock("@server/auth/client", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
      passkey: (...args: unknown[]) => signInPasskey(...args),
    },
  },
}));

import { LoginPage } from "../src/client/components/LoginPage";
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
    signInEmail.mockReset();
    signInPasskey.mockReset();
    // jsdom has no WebAuthn; conditional autofill must stay silent.
    signInPasskey.mockResolvedValue({
      data: null,
      error: { message: "unsupported" },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers passkey sign-in and finishes when the device confirms", async () => {
    const { onLoginSuccess } = renderLogin();
    signInPasskey.mockResolvedValueOnce({ data: { session: {} }, error: null });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledTimes(1));
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("explains a cancelled passkey prompt and lets the user fall back to a password", async () => {
    renderLogin();
    signInPasskey.mockResolvedValueOnce({
      data: null,
      error: { message: "The operation either timed out or was not allowed." },
    });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled/i);
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
  });

  it("validates inline before calling the API", async () => {
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Email address/), "kari@example.com");
    expect(screen.queryByText("Enter your email address.")).toBeNull();
  });

  it("signs in with email + password and supports show/hide", async () => {
    const { onLoginSuccess } = renderLogin();
    signInEmail.mockResolvedValue({ data: { user: {} }, error: null });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Email address/), "kari@example.com");
    const password = screen.getByLabelText(/^Password/);
    await user.type(password, "correct-horse-battery");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledTimes(1));
    expect(signInEmail).toHaveBeenCalledWith({
      email: "kari@example.com",
      password: "correct-horse-battery",
      rememberMe: true,
    });
  });

  it("shows the server's error for a wrong password", async () => {
    renderLogin();
    signInEmail.mockResolvedValue({
      data: null,
      error: { message: "Invalid email or password" },
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Email address/), "kari@example.com");
    await user.type(screen.getByLabelText(/^Password/), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password",
    );
  });
});
