import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsView } from "../src/client/components/SettingsView";

describe("SettingsView", () => {
  it("renders profile, password reset, 2FA, passkey, and sessions controls", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        profile={{
          id: "user-1",
          email: "member@example.com",
          name: "Member Person",
          image: "https://example.com/avatar.png",
          role: "user",
          twoFactorEnabled: false,
          households: [],
        }}
        sessions={[
          {
            id: "session-1",
            isCurrent: true,
            expiresAt: "2026-06-01T12:00:00.000Z",
            ipAddress: "127.0.0.1",
            userAgent: "Safari",
            createdAt: "2026-05-01T12:00:00.000Z",
            updatedAt: "2026-05-02T12:00:00.000Z",
            impersonatedBy: null,
          },
        ]}
        isLoading={false}
        error={null}
        formState={{
          name: "Member Person",
          image: "https://example.com/avatar.png",
          currentPassword: "",
          newPassword: "",
          forgotPasswordEmail: "member@example.com",
          twoFactorPassword: "",
          twoFactorCode: "",
          twoFactorBackupCode: "",
          passkeyName: "MacBook",
        }}
        onFormChange={vi.fn()}
        onUpdateProfile={vi.fn()}
        onChangePassword={vi.fn()}
        onRequestPasswordReset={vi.fn()}
        onEnable2FA={vi.fn()}
        onDisable2FA={vi.fn()}
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

    expect(html).toContain("Account Settings");
    expect(html).toContain("Save Profile");
    expect(html).toContain("Change Password");
    expect(html).toContain("Password Reset Email");
    expect(html).toContain("Send Reset Link");
    expect(html).toContain("Two-Factor Authentication");
    expect(html).toContain("Enable 2FA");
    expect(html).toContain("Passkeys");
    expect(html).toContain("Add Passkey");
    expect(html).toContain("Active Sessions");
    expect(html).toContain("Revoke Others");
  });

  it("shows the disable 2FA flow when 2FA is enabled", () => {
    const html = renderToStaticMarkup(
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
        onDisable2FA={vi.fn()}
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

    expect(html).toContain("Disable 2FA");
    expect(html).not.toContain("Enable 2FA");
  });

  it("shows the enrolment step (QR, manual key, backup codes, verify) while 2FA setup is pending", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        profile={{
          id: "user-1",
          email: "member@example.com",
          name: "Member Person",
          image: null,
          role: "user",
          twoFactorEnabled: false,
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
          forgotPasswordEmail: "",
          twoFactorPassword: "",
          twoFactorCode: "",
          twoFactorBackupCode: "",
          passkeyName: "",
        }}
        onFormChange={vi.fn()}
        onUpdateProfile={vi.fn()}
        onChangePassword={vi.fn()}
        onRequestPasswordReset={vi.fn()}
        onEnable2FA={vi.fn()}
        onDisable2FA={vi.fn()}
        twoFactorSetup={{
          totpURI:
            "otpauth://totp/Mi%20Casa:member@example.com?secret=JBSWY3DPEHPK3PXP",
          qrDataUrl: "data:image/png;base64,AAAA",
          secret: "JBSWY3DPEHPK3PXP",
          backupCodes: ["aaaa-bbbb", "cccc-dddd"],
        }}
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

    expect(html).toContain("Authenticator QR code");
    expect(html).toContain("JBSWY3DPEHPK3PXP");
    expect(html).toContain("aaaa-bbbb");
    expect(html).toContain("Verify and enable");
    expect(html).not.toContain(">Enable 2FA<");
  });
});

describe("SettingsView install card", () => {
  function render(install: Parameters<typeof SettingsView>[0]["install"]) {
    return renderToStaticMarkup(
      <SettingsView
        profile={{
          id: "user-1",
          email: "member@example.com",
          name: "Member Person",
          image: null,
          role: "user",
          twoFactorEnabled: false,
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
          twoFactorPassword: "",
          twoFactorCode: "",
          twoFactorBackupCode: "",
          passkeyName: "",
        }}
        onFormChange={vi.fn()}
        onUpdateProfile={vi.fn()}
        onChangePassword={vi.fn()}
        onRequestPasswordReset={vi.fn()}
        onEnable2FA={vi.fn()}
        onDisable2FA={vi.fn()}
        twoFactorSetup={null}
        onVerify2FA={vi.fn()}
        onCancel2FASetup={vi.fn()}
        onLeaveHousehold={vi.fn()}
        onAddPasskey={vi.fn()}
        onRevokeSession={vi.fn()}
        onRevokeOtherSessions={vi.fn()}
        isSaving={false}
        install={install}
      />,
    );
  }

  it("offers an Install button when the browser exposes an install prompt", () => {
    const html = render({ status: "available", onInstall: vi.fn() });
    expect(html).toContain("Install the app");
    expect(html).toContain("Install");
    expect(html).not.toContain("Add to Home Screen");
  });

  it("explains Add to Home Screen when no prompt is available (iOS Safari)", () => {
    const html = render({ status: "manual", onInstall: vi.fn() });
    expect(html).toContain("Install the app");
    expect(html).toContain("Add to Home Screen");
  });

  it("confirms when the app is already running installed", () => {
    const html = render({ status: "installed", onInstall: vi.fn() });
    expect(html).toContain("Install the app");
    expect(html).toContain("installed");
    expect(html).not.toContain("Add to Home Screen");
  });
});
