// @vitest-environment jsdom
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ForgotPasswordPage } from "../src/components/ForgotPasswordPage";
import { LoginPage } from "../src/components/LoginPage";
import { ResetPasswordPage } from "../src/components/ResetPasswordPage";
import { renderClient } from "./client-test-utils";

// TanStack Router's Link and useSearch need a live router, so these render
// into jsdom at the path under test instead of to static markup.
function markup(ui: ReactElement, path: string) {
  return renderClient(ui, { initialEntries: [path] }).container.innerHTML;
}

describe("password reset pages", () => {
  it("login page links to the forgot-password flow", () => {
    const html = markup(
      <LoginPage
        setupStatus={null}
        setupError={null}
        onLoginSuccess={() => {}}
      />,
      "/login",
    );
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain("Forgot your password?");
  });

  it("forgot-password page asks for an email and links back to sign in", () => {
    const html = markup(<ForgotPasswordPage />, "/forgot-password");
    expect(html).toContain("Send reset link");
    expect(html).toContain('href="/login"');
  });

  it("reset page shows the new-password form when a token is present", () => {
    const html = markup(<ResetPasswordPage />, "/reset-password?token=abc");
    expect(html).toContain("New password");
    expect(html).toContain("Update password");
  });

  it("reset page explains invalid or missing tokens and offers a new link", () => {
    for (const entry of [
      "/reset-password",
      "/reset-password?error=INVALID_TOKEN",
    ]) {
      const html = markup(<ResetPasswordPage />, entry);
      expect(html).toContain("invalid or has expired");
      expect(html).toContain('href="/forgot-password"');
    }
  });
});
