import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TwoFactorPage } from "../src/components/TwoFactorPage";

describe("TwoFactorPage", () => {
  it("asks for the authenticator code, offers backup codes and a way back", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/two-factor"]}>
        <TwoFactorPage onVerified={vi.fn()} />
      </MemoryRouter>,
    );
    expect(html).toContain("Authenticator code");
    expect(html).toContain("Use a backup code");
    expect(html).toContain("Trust this device");
    expect(html).toContain('href="/login"');
  });
});
