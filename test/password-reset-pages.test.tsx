import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ForgotPasswordPage } from "../src/client/components/ForgotPasswordPage";
import { LoginPage } from "../src/client/components/LoginPage";
import { ResetPasswordPage } from "../src/client/components/ResetPasswordPage";

describe("password reset pages", () => {
  it("login page links to the forgot-password flow", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage
          setupStatus={null}
          setupError={null}
          onLoginSuccess={() => {}}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain("Forgot your password?");
  });

  it("forgot-password page asks for an email and links back to sign in", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Send reset link");
    expect(html).toContain('href="/login"');
  });

  it("reset page shows the new-password form when a token is present", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/reset-password?token=abc"]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );
    expect(html).toContain("New password");
    expect(html).toContain("Update password");
  });

  it("reset page explains invalid or missing tokens and offers a new link", () => {
    for (const entry of [
      "/reset-password",
      "/reset-password?error=INVALID_TOKEN",
    ]) {
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={[entry]}>
          <ResetPasswordPage />
        </MemoryRouter>,
      );
      expect(html).toContain("invalid or has expired");
      expect(html).toContain('href="/forgot-password"');
    }
  });
});
