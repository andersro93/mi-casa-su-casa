// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { SettingsView } from "../src/client/components/SettingsView";
import { renderClient, screen, userEvent, within } from "./client-test-utils";

function renderEnabled2FA(onDisable2FA = vi.fn().mockResolvedValue(true)) {
  renderClient(
    <SettingsView
      profile={{
        id: "user-1",
        email: "member@example.com",
        name: "Member Person",
        image: null,
        role: "user",
        twoFactorEnabled: true,
        households: [],
      }}
      sessions={[]}
      isLoading={false}
      error={null}
      formState={{
        name: "Member Person",
        image: "",
        currentPassword: "",
        newPassword: "",
        forgotPasswordEmail: "member@example.com",
        twoFactorPassword: "secret-password",
        twoFactorCode: "",
        twoFactorBackupCode: "",
        passkeyName: "",
      }}
      onFormChange={vi.fn()}
      onUpdateProfile={vi.fn()}
      onChangePassword={vi.fn()}
      onRequestPasswordReset={vi.fn()}
      onEnable2FA={vi.fn()}
      onDisable2FA={onDisable2FA}
      twoFactorSetup={null}
      onVerify2FA={vi.fn()}
      onCancel2FASetup={vi.fn()}
      onLeaveHousehold={vi.fn()}
      onAddPasskey={vi.fn()}
      onRevokeSession={vi.fn()}
      onRevokeOtherSessions={vi.fn()}
      isSaving={false}
      install={{ status: "manual", onInstall: vi.fn() }}
    />,
  );
  return { onDisable2FA };
}

describe("SettingsView — disabling 2FA", () => {
  it("pressing Enter in the password field opens the confirmation instead of disabling immediately", async () => {
    const user = userEvent.setup();
    const { onDisable2FA } = renderEnabled2FA();

    const disableButton = screen.getByRole("button", { name: "Disable 2FA" });
    const form = disableButton.closest("form");
    expect(form).not.toBeNull();
    const passwordField = within(form as HTMLFormElement).getByLabelText(
      /current password/i,
    );

    await user.click(passwordField);
    await user.keyboard("{Enter}");

    expect(onDisable2FA).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Disable two-factor authentication?"),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Disable 2FA" }),
    );
    expect(onDisable2FA).toHaveBeenCalledTimes(1);
  });
});
