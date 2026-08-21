// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProvidersRulesView } from "../src/client/components/ProvidersRulesView";
import { renderClient, screen, userEvent, within } from "./client-test-utils";

vi.mock("@mui/x-data-grid", () => ({
  DataGrid: () => <div data-testid="mock-grid" />,
}));

const provider = {
  id: "provider-1",
  provider_key: "netflix",
  display_name: "Netflix",
  created_at: "2026-05-10T12:00:00.000Z",
  rule_count: 1,
};

const rule = {
  id: "rule-1",
  provider_id: "provider-1",
  match_type: "domain" as const,
  match_value: "netflix.com",
  created_at: "2026-05-10T12:00:00.000Z",
};

function renderView(
  overrides: Partial<Parameters<typeof ProvidersRulesView>[0]> = {},
) {
  return renderClient(
    <ProvidersRulesView
      providers={[provider]}
      rules={[rule]}
      selectedProviderId="provider-1"
      selectedRuleId="rule-1"
      providerFormState={{ providerKey: "netflix", displayName: "Netflix" }}
      ruleFormState={{
        providerId: "provider-1",
        matchType: "domain",
        matchValue: "netflix.com",
      }}
      isSaving={false}
      onSelectProvider={vi.fn()}
      onSelectRule={vi.fn()}
      onProviderFormChange={vi.fn()}
      onRuleFormChange={vi.fn()}
      onCreateProvider={vi.fn().mockResolvedValue(true)}
      onUpdateProvider={vi.fn().mockResolvedValue(true)}
      onDeleteProvider={vi.fn().mockResolvedValue(true)}
      onCreateRule={vi.fn().mockResolvedValue(true)}
      onUpdateRule={vi.fn().mockResolvedValue(true)}
      onDeleteRule={vi.fn().mockResolvedValue(true)}
      {...overrides}
    />,
  );
}

/** Records whether the native submit event reached the document un-prevented. */
function trackSubmit() {
  const submits: boolean[] = [];
  const listener = (event: Event) => {
    submits.push(event.defaultPrevented);
  };
  document.addEventListener("submit", listener);
  return {
    submits,
    stop: () => document.removeEventListener("submit", listener),
  };
}

describe("ProvidersRulesView edit dialogs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saving an edited provider calls onUpdateProvider and prevents the native form submit", async () => {
    const user = userEvent.setup();
    const onUpdateProvider = vi.fn().mockResolvedValue(true);
    const tracker = trackSubmit();

    renderView({ onUpdateProvider });

    // The provider "Edit selected" button comes first; the rule one second.
    await user.click(
      screen.getAllByRole("button", { name: "Edit selected" })[0],
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit provider")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Save provider" }),
    );

    expect(onUpdateProvider).toHaveBeenCalledTimes(1);
    expect(tracker.submits).toEqual([true]);
    tracker.stop();
  });

  it("saving an edited rule calls onUpdateRule and prevents the native form submit", async () => {
    const user = userEvent.setup();
    const onUpdateRule = vi.fn().mockResolvedValue(true);
    const tracker = trackSubmit();

    renderView({ onUpdateRule });

    await user.click(
      screen.getAllByRole("button", { name: "Edit selected" })[1],
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit sender rule")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));

    expect(onUpdateRule).toHaveBeenCalledTimes(1);
    expect(tracker.submits).toEqual([true]);
    tracker.stop();
  });
});
