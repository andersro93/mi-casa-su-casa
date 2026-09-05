// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HouseholdSettingsPage } from "../src/components/household/HouseholdSettingsPage";
import { renderClient, screen, userEvent, waitFor } from "./client-test-utils";
import { readRequest } from "./fetch-mock";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(emailAddress: string | null) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method, body } = await readRequest(input, init);
      calls.push({ url, method, body });
      if (url.endsWith("/api/admin/olsen/settings")) {
        return json({
          household: {
            slug: "olsen",
            displayName: "Familien Olsen",
            emailAddress,
          },
        });
      }
      return json({ error: "unhandled" }, 404);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("HouseholdSettingsPage", () => {
  it("shows the inbox address prominently with a copy button and what to do with it", async () => {
    mockApi("olsen@example.com");
    renderClient(<HouseholdSettingsPage slug="olsen" onRenamed={vi.fn()} />, {
      initialEntries: ["/olsen/settings"],
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Household settings",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("olsen@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/When a service asks for an email address/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/plan/i)).toBeNull();
  });

  it("explains a missing EMAIL_DOMAIN as an alert, not a field value", async () => {
    mockApi(null);
    renderClient(<HouseholdSettingsPage slug="olsen" onRenamed={vi.fn()} />, {
      initialEntries: ["/olsen/settings"],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/EMAIL_DOMAIN/);
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  });

  it("renames the household with inline validation", async () => {
    const calls = mockApi("olsen@example.com");
    const onRenamed = vi.fn();
    renderClient(<HouseholdSettingsPage slug="olsen" onRenamed={onRenamed} />, {
      initialEntries: ["/olsen/settings"],
    });
    const user = userEvent.setup();
    const field = await screen.findByRole("textbox", {
      name: /Household name/,
    });
    await waitFor(() => expect(field).toHaveValue("Familien Olsen"));
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    await user.clear(field);
    await user.type(field, "Olsen-gjengen");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(onRenamed).toHaveBeenCalledWith("Olsen-gjengen"),
    );
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({
      displayName: "Olsen-gjengen",
    });
  });
});
