// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { TwoFactorPage } from "../src/components/TwoFactorPage";
import { renderClient } from "./client-test-utils";

describe("TwoFactorPage", () => {
  it("asks for the authenticator code, offers backup codes and a way back", () => {
    // TanStack Router's Link needs a live router, so this renders into jsdom
    // instead of to static markup.
    const { container } = renderClient(<TwoFactorPage onVerified={vi.fn()} />, {
      initialEntries: ["/two-factor"],
    });
    const html = container.innerHTML;

    expect(html).toContain("Authenticator code");
    expect(html).toContain("Use a backup code");
    expect(html).toContain("Trust this device");
    expect(html).toContain('href="/login"');
  });
});
