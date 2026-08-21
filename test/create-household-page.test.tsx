// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateHouseholdPage } from "../src/client/components/CreateHouseholdPage";
import { describeSlugProblem } from "../src/client/components/HouseholdAddressField";
import { SetupPage } from "../src/client/components/SetupPage";
import { suggestHouseholdSlug } from "../src/client/utils";
import { renderClient, screen, userEvent, waitFor } from "./client-test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suggestHouseholdSlug", () => {
  it("derives a usable inbox address from a household name", () => {
    expect(suggestHouseholdSlug("Familien Olsen")).toBe("familien-olsen");
    expect(suggestHouseholdSlug("Casa Ramírez!")).toBe("casa-ramirez");
    expect(suggestHouseholdSlug("  The   Smiths ")).toBe("the-smiths");
    expect(suggestHouseholdSlug("x".repeat(60))).toHaveLength(40);
    expect(suggestHouseholdSlug("")).toBe("");
  });

  it("explains slug problems in plain language", () => {
    expect(describeSlugProblem("familien-olsen")).toBeNull();
    expect(describeSlugProblem("")).toMatch(/Choose an address/);
    expect(describeSlugProblem("inbox")).toMatch(/reserved/);
    expect(describeSlugProblem("a")).toMatch(/between 2 and 40/);
    expect(describeSlugProblem("bad_name")).toMatch(
      /lowercase letters, numbers and hyphens/,
    );
  });
});

describe("CreateHouseholdPage", () => {
  it("derives the address from the name, previews it, and submits both", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: init?.body as string | undefined,
        });
        return new Response(
          JSON.stringify({
            household: {
              id: "h1",
              slug: "familien-olsen",
              displayName: "Familien Olsen",
              role: "owner",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const onCreated = vi.fn();
    renderClient(
      <CreateHouseholdPage onCreated={onCreated} emailDomain="example.com" />,
      { initialEntries: ["/new-household"] },
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Household name/), "Familien Olsen");
    const address = screen.getByLabelText(/Inbox address/) as HTMLInputElement;
    expect(address.value).toBe("familien-olsen");
    expect(
      screen.getByText(/Login codes will arrive at familien-olsen@example.com/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create household" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      displayName: "Familien Olsen",
      slug: "familien-olsen",
    });
  });

  it("keeps a hand-edited address and validates inline", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderClient(
      <CreateHouseholdPage onCreated={vi.fn()} emailDomain="example.com" />,
      { initialEntries: ["/new-household"] },
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Inbox address/), "inbox");
    await user.type(screen.getByLabelText(/Household name/), "Our home");
    expect(
      (screen.getByLabelText(/Inbox address/) as HTMLInputElement).value,
    ).toBe("inbox");

    await user.click(screen.getByRole("button", { name: "Create household" }));
    expect(screen.getByText(/reserved/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("SetupPage", () => {
  it("groups the form, derives the address, and shows the password rule up front", async () => {
    renderClient(
      <SetupPage
        onSetupComplete={vi.fn()}
        onSetupError={vi.fn()}
        setupError={null}
        emailDomain="example.com"
      />,
      { initialEntries: ["/setup"] },
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Your household" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Your account" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/At least 12 characters/)).toBeInTheDocument();

    await userEvent
      .setup()
      .type(screen.getByLabelText(/Household name/), "Casa Ramírez");
    expect(
      (screen.getByLabelText(/Inbox address/) as HTMLInputElement).value,
    ).toBe("casa-ramirez");
    expect(screen.getByText(/casa-ramirez@example.com/)).toBeInTheDocument();
  });

  it("does not submit while required fields are missing; errors show inline", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderClient(
      <SetupPage
        onSetupComplete={vi.fn()}
        onSetupError={vi.fn()}
        setupError={null}
      />,
      { initialEntries: ["/setup"] },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Complete setup" }));
    expect(screen.getByText("Give your household a name.")).toBeInTheDocument();
    expect(screen.getByText("Enter the setup secret.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
