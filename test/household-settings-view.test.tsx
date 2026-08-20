import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HouseholdSettingsView } from "../src/client/components/HouseholdSettingsView";

describe("HouseholdSettingsView", () => {
  it("renders readonly slug, inbox address, and editable household name", () => {
    const html = renderToStaticMarkup(
      <HouseholdSettingsView
        household={{
          slug: "home",
          emailAddress: "home@example.com",
          displayName: "Home",
        }}
        isLoading={false}
        error={null}
        formState={{
          displayName: "Home",
        }}
        onFormChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
      />,
    );

    expect(html).toContain("Household Settings");
    expect(html).toContain("Household details");
    expect(html).toContain("Household slug");
    expect(html).toContain("home");
    expect(html).toContain("Household email address");
    expect(html).toContain("home@example.com");
    expect(html).toContain("Household name");
    expect(html).not.toContain("Subscription plan");
    expect(html).toContain("Save Household Name");
  });

  it("explains how to get an inbox address when EMAIL_DOMAIN is not configured", () => {
    const html = renderToStaticMarkup(
      <HouseholdSettingsView
        household={{ slug: "home", emailAddress: null, displayName: "Home" }}
        isLoading={false}
        error={null}
        formState={{ displayName: "Home" }}
        onFormChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
      />,
    );
    expect(html).toContain("Not configured");
    expect(html).toContain("EMAIL_DOMAIN");
  });
});
