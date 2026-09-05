// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act } from "react";
import { describe, expect, it } from "vitest";

import { AppMessageProvider, useAppMessages } from "../src/lib/messages";
// Imported from the shared utils for their afterEach(cleanup) registration.
import { render, screen, waitFor } from "./client-test-utils";

type Messages = ReturnType<typeof useAppMessages>;

/**
 * The snackbar dismisses itself on any click away, so these drive the context
 * directly rather than through buttons — otherwise the click meant to raise
 * the next message also closes the current one.
 */
function setup() {
  let api: Messages | undefined;

  function Probe() {
    api = useAppMessages();
    return null;
  }

  render(
    <AppMessageProvider>
      <Probe />
    </AppMessageProvider>,
  );

  return () => {
    if (!api) throw new Error("provider did not render");
    return api;
  };
}

describe("AppMessageProvider", () => {
  it("shows a confirmation", async () => {
    const messages = setup();

    act(() => messages().notify("Saved."));

    expect(await screen.findByRole("alert")).toHaveTextContent("Saved.");
  });

  it("shows a failure in the same place", async () => {
    const messages = setup();

    act(() => messages().notifyError("Unable to load households"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load households",
    );
  });

  it("dismisses whatever is showing", async () => {
    // Signing out calls this: a message raised while signed in must not
    // follow the visitor onto the sign-in screen.
    const messages = setup();
    act(() => messages().notifyError("Unauthorized"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");

    act(() => messages().dismiss());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
