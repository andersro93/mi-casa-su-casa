// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InstallProvider,
  useInstallState,
} from "../src/hooks/useInstallPrompt";
// Imported from the shared utils for their afterEach(cleanup) registration.
import { render, screen } from "./client-test-utils";

function Probe() {
  const install = useInstallState();
  return <span data-testid="status">{install.status}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InstallProvider", () => {
  it("registers the beforeinstallprompt listener when it mounts", () => {
    // The browser fires beforeinstallprompt once, shortly after load. The
    // provider is mounted by the router's root route, so the listener is in
    // place before any guard resolves — the account-settings route, which
    // used to own this hook, mounts far too late to hear it.
    const addEventListener = vi.spyOn(window, "addEventListener");

    render(
      <InstallProvider>
        <Probe />
      </InstallProvider>,
    );

    const events = addEventListener.mock.calls.map(([name]) => name);
    expect(events).toContain("beforeinstallprompt");
    expect(events).toContain("appinstalled");
  });

  it("offers the browser's own prompt once the event has fired", () => {
    render(
      <InstallProvider>
        <Probe />
      </InstallProvider>,
    );
    expect(screen.getByTestId("status")).toHaveTextContent("manual");

    act(() => {
      window.dispatchEvent(new Event("beforeinstallprompt"));
    });

    expect(screen.getByTestId("status")).toHaveTextContent("available");
  });

  it("falls back to the manual instructions outside the provider", () => {
    render(<Probe />);
    expect(screen.getByTestId("status")).toHaveTextContent("manual");
  });
});
