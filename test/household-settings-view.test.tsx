import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HouseholdSettingsView } from "../src/client/components/HouseholdSettingsView";

describe("HouseholdSettingsView", () => {
  it("renders readonly slug, email, plan, and editable household name", () => {
    const html = renderToStaticMarkup(
      <HouseholdSettingsView
        household={{
          slug: "home",
          emailAddress: "home@DOMAIN",
          displayName: "Home",
          subscriptionPlan: "Free Plan",
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
    expect(html).toContain("home@DOMAIN");
    expect(html).toContain("Household name");
    expect(html).toContain("Subscription plan");
    expect(html).toContain("Free Plan");
    expect(html).toContain("Save Household Name");
  });
});
