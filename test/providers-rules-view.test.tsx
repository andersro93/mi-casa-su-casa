import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProvidersRulesView } from "../src/client/components/ProvidersRulesView";

vi.mock("@mui/x-data-grid", () => ({
  DataGrid: ({
    rows,
    columns,
  }: {
    rows: unknown[];
    columns: Array<{ headerName?: string }>;
  }) => (
    <div data-testid="mock-grid">
      <span>rows:{rows.length}</span>
      {columns.map((column) => (
        <span key={column.headerName}>{column.headerName}</span>
      ))}
    </div>
  ),
}));

describe("ProvidersRulesView", () => {
  it("renders provider and sender rule admin controls", () => {
    const html = renderToStaticMarkup(
      <ProvidersRulesView
        providers={[
          {
            id: "provider-1",
            provider_key: "netflix",
            display_name: "Netflix",
            created_at: "2026-05-10T12:00:00.000Z",
            rule_count: 2,
          },
        ]}
        rules={[
          {
            id: "rule-1",
            provider_id: "provider-1",
            match_type: "domain",
            match_value: "netflix.com",
            created_at: "2026-05-10T12:00:00.000Z",
          },
        ]}
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
        onCreateProvider={vi.fn()}
        onUpdateProvider={vi.fn()}
        onDeleteProvider={vi.fn()}
        onCreateRule={vi.fn()}
        onUpdateRule={vi.fn()}
        onDeleteRule={vi.fn()}
      />,
    );

    expect(html).toContain("Provider and rule setup");
    expect(html).toContain("Connected providers");
    expect(html).toContain("Sender rules");
    expect(html).toContain("Provider actions");
    expect(html).toContain("Rule actions");
    expect(html).toContain("Create provider");
    expect(html).toContain("Add rule");
    expect(html).toContain("Edit selected");
    expect(html).toContain("Match value");
  });
});
