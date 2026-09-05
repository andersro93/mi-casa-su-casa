// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyTwoFactor = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  verifyTwoFactor: (...args: unknown[]) => verifyTwoFactor(...args),
}));

import { TwoFactorPage } from "../src/components/TwoFactorPage";
import { renderClient, screen, userEvent, waitFor } from "./client-test-utils";

function renderPage(onVerified = vi.fn()) {
  renderClient(<TwoFactorPage onVerified={onVerified} />, {
    initialEntries: ["/two-factor"],
  });
  return { onVerified };
}

describe("TwoFactorPage", () => {
  beforeEach(() => {
    verifyTwoFactor.mockReset();
    verifyTwoFactor.mockResolvedValue(undefined);
  });

  it("asks for the authenticator code, offers backup codes and a way back", () => {
    renderPage();
    expect(screen.getByLabelText(/Authenticator code/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use a backup code" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/login");
  });

  it("verifies a TOTP code and finishes the sign-in", async () => {
    const { onVerified } = renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Authenticator code/), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(verifyTwoFactor).toHaveBeenCalledWith("123456");
  });

  it("sends a backup code down the same route", async () => {
    // The server recognises a backup code by its shape, so switching the
    // toggle changes the wording and nothing else.
    const { onVerified } = renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Use a backup code" }));
    await user.type(screen.getByLabelText(/Backup code/), "1111-2222");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(verifyTwoFactor).toHaveBeenCalledWith("1111-2222");
  });

  it("shows the server's message when the code is refused", async () => {
    renderPage();
    verifyTwoFactor.mockRejectedValue(new Error("Invalid code"));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Authenticator code/), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
  });
});
