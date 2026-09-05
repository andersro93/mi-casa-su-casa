// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../src/components/ConfirmDialog";
import { renderClient, screen, userEvent } from "./client-test-utils";

describe("ConfirmDialog", () => {
  it("calls onConfirm when the confirm button is clicked and onClose on cancel", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    renderClient(
      <ConfirmDialog
        open
        title="Remove Alex?"
        description="They lose access immediately."
        confirmLabel="Remove member"
        confirmColor="error"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("They lose access immediately.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Remove member" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons and shows a working label while loading", () => {
    renderClient(
      <ConfirmDialog
        open
        isLoading
        title="Leave household?"
        description="You can be invited back later."
        confirmLabel="Leave"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
