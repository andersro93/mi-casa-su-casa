import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, Fragment, useState } from "react";
import type {
  AccountProfile,
  AccountSession,
  AccountSettingsFormState,
  InstallState,
  TwoFactorSetup,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

interface SettingsViewProps {
  profile: AccountProfile | null;
  sessions: AccountSession[];
  isLoading: boolean;
  error: string | null;
  formState: AccountSettingsFormState;
  onFormChange: (update: Partial<AccountSettingsFormState>) => void;
  onUpdateProfile: (e: FormEvent<HTMLFormElement>) => void;
  onChangePassword: (e: FormEvent<HTMLFormElement>) => void;
  onRequestPasswordReset: (e: FormEvent<HTMLFormElement>) => void;
  onEnable2FA: (e: FormEvent<HTMLFormElement>) => void;
  onDisable2FA: () => Promise<boolean>;
  twoFactorSetup: TwoFactorSetup | null;
  onVerify2FA: (e: FormEvent<HTMLFormElement>) => void;
  onCancel2FASetup: () => void;
  onLeaveHousehold: (slug: string) => Promise<boolean>;
  onAddPasskey: (e: FormEvent<HTMLFormElement>) => void;
  onRevokeSession: (sessionId: string) => Promise<boolean>;
  onRevokeOtherSessions: () => Promise<boolean>;
  isSaving: boolean;
  install: InstallState;
}

export function SettingsView({
  profile,
  sessions,
  isLoading,
  error,
  formState,
  onFormChange,
  onUpdateProfile,
  onChangePassword,
  onRequestPasswordReset,
  onEnable2FA,
  onDisable2FA,
  twoFactorSetup,
  onVerify2FA,
  onCancel2FASetup,
  onLeaveHousehold,
  onAddPasskey,
  onRevokeSession,
  onRevokeOtherSessions,
  isSaving,
  install,
}: SettingsViewProps) {
  const [sessionToRevoke, setSessionToRevoke] = useState<AccountSession | null>(
    null,
  );
  const [isRevokeOthersOpen, setIsRevokeOthersOpen] = useState(false);
  const [isDisable2FAOpen, setIsDisable2FAOpen] = useState(false);
  const [householdToLeave, setHouseholdToLeave] = useState<{
    slug: string;
    displayName: string;
  } | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  if (isLoading && !profile) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!profile) {
    return <Alert severity="error">{error || "Unable to load profile"}</Alert>;
  }

  const handleDisable2FAConfirm = async () => {
    const didDisable = await onDisable2FA();

    if (didDisable) {
      setIsDisable2FAOpen(false);
    }
  };

  const handleRevokeSessionConfirm = async () => {
    if (!sessionToRevoke) {
      return;
    }

    const didRevoke = await onRevokeSession(sessionToRevoke.id);

    if (didRevoke) {
      setSessionToRevoke(null);
    }
  };

  const handleRevokeOthersConfirm = async () => {
    const didRevoke = await onRevokeOtherSessions();

    if (didRevoke) {
      setIsRevokeOthersOpen(false);
    }
  };

  return (
    <Container maxWidth="md" disableGutters>
      <Box sx={{ mb: 4, px: { xs: 0.5, sm: 0 } }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: "bold" }}>
          Account Settings
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your profile, password, two-factor authentication, passkeys,
          and active sessions.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 4, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {/* Profile Card */}
      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader title="Profile" />
        <Divider />
        <CardContent>
          <Box component="form" onSubmit={onUpdateProfile}>
            <Stack spacing={2}>
              <Box>
                <TextField
                  fullWidth
                  label="Name"
                  value={formState.name}
                  onChange={(e) => onFormChange({ name: e.target.value })}
                  required
                />
              </Box>
              <Box>
                <TextField
                  fullWidth
                  label="Avatar URL"
                  value={formState.image}
                  onChange={(e) => onFormChange({ image: e.target.value })}
                />
              </Box>
              <Box>
                <TextField
                  fullWidth
                  label="Email"
                  value={profile.email}
                  disabled
                />
              </Box>
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={isSaving || !formState.name.trim()}
                >
                  Save Profile
                </Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      {/* Password Card */}
      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader title="Change Password" />
        <Divider />
        <CardContent>
          <Box component="form" onSubmit={onChangePassword}>
            <Stack spacing={2}>
              <Box>
                <TextField
                  fullWidth
                  type="password"
                  label="Current Password"
                  value={formState.currentPassword}
                  onChange={(e) =>
                    onFormChange({ currentPassword: e.target.value })
                  }
                  required
                />
              </Box>
              <Box>
                <TextField
                  fullWidth
                  type="password"
                  label="New Password"
                  value={formState.newPassword}
                  onChange={(e) =>
                    onFormChange({ newPassword: e.target.value })
                  }
                  required
                />
              </Box>
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={
                    isSaving ||
                    !formState.currentPassword ||
                    !formState.newPassword
                  }
                >
                  Change Password
                </Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader title="Password Reset Email" />
        <Divider />
        <CardContent>
          <Box component="form" onSubmit={onRequestPasswordReset}>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              Send yourself a secure reset link if you want to rotate your
              password from email instead.
            </Typography>
            <Stack spacing={2}>
              <Box>
                <TextField
                  fullWidth
                  type="email"
                  label="Reset Email"
                  value={formState.forgotPasswordEmail}
                  onChange={(e) =>
                    onFormChange({ forgotPasswordEmail: e.target.value })
                  }
                  required
                />
              </Box>
              <Box>
                <Button
                  type="submit"
                  variant="outlined"
                  disabled={isSaving || !formState.forgotPasswordEmail.trim()}
                >
                  Send Reset Link
                </Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      {/* Two-Factor Authentication */}
      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader title="Two-Factor Authentication" />
        <Divider />
        <CardContent>
          {twoFactorSetup ? (
            <Box component="form" onSubmit={onVerify2FA}>
              <Typography variant="body1" sx={{ mb: 2 }}>
                Scan the QR code with your authenticator app (or enter the key
                manually), save the backup codes somewhere safe, then enter the
                current 6-digit code to finish enabling two-factor
                authentication.
              </Typography>
              <Stack spacing={2}>
                {twoFactorSetup.qrDataUrl ? (
                  <Box>
                    <img
                      src={twoFactorSetup.qrDataUrl}
                      alt="Authenticator QR code"
                      width={192}
                      height={192}
                      style={{ display: "block", borderRadius: 8 }}
                    />
                  </Box>
                ) : null}
                {twoFactorSetup.secret ? (
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                  >
                    Manual key: {twoFactorSetup.secret}
                  </Typography>
                ) : null}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Backup codes (each works once)
                  </Typography>
                  <Box
                    component="ul"
                    sx={{
                      m: 0,
                      pl: 2,
                      columns: 2,
                      fontFamily: "monospace",
                    }}
                  >
                    {twoFactorSetup.backupCodes.map((backupCode) => (
                      <li key={backupCode}>{backupCode}</li>
                    ))}
                  </Box>
                </Box>
                <TextField
                  fullWidth
                  label="Code from your authenticator app"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={formState.twoFactorCode}
                  onChange={(e) =>
                    onFormChange({ twoFactorCode: e.target.value })
                  }
                  required
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={isSaving || formState.twoFactorCode.trim() === ""}
                  >
                    Verify and enable
                  </Button>
                  <Button
                    type="button"
                    variant="text"
                    disabled={isSaving}
                    onClick={onCancel2FASetup}
                  >
                    Cancel
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ) : profile.twoFactorEnabled ? (
            <Box
              component="form"
              onSubmit={(e) => {
                // Enter in the password field must go through the same
                // confirmation as the button — never disable 2FA directly.
                e.preventDefault();
                if (formState.twoFactorPassword) {
                  setIsDisable2FAOpen(true);
                }
              }}
            >
              <Typography variant="body1" sx={{ mb: 2 }}>
                Two-factor authentication is currently enabled. Enter your
                password to disable it.
              </Typography>
              <Stack spacing={2}>
                <Box>
                  <TextField
                    fullWidth
                    type="password"
                    label="Current Password"
                    value={formState.twoFactorPassword}
                    onChange={(e) =>
                      onFormChange({ twoFactorPassword: e.target.value })
                    }
                    required
                  />
                </Box>
                <Box>
                  <Button
                    type="button"
                    variant="outlined"
                    color="error"
                    disabled={isSaving || !formState.twoFactorPassword}
                    onClick={() => setIsDisable2FAOpen(true)}
                  >
                    Disable 2FA
                  </Button>
                </Box>
              </Stack>
            </Box>
          ) : (
            <Box component="form" onSubmit={onEnable2FA}>
              <Typography variant="body1" sx={{ mb: 2 }}>
                Enter your password to enable two-factor authentication.
              </Typography>
              <Stack spacing={2}>
                <Box>
                  <TextField
                    fullWidth
                    type="password"
                    label="Current Password"
                    value={formState.twoFactorPassword}
                    onChange={(e) =>
                      onFormChange({ twoFactorPassword: e.target.value })
                    }
                    required
                  />
                </Box>
                <Box>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={isSaving || !formState.twoFactorPassword}
                  >
                    Enable 2FA
                  </Button>
                </Box>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Passkeys */}
      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader title="Passkeys" />
        <Divider />
        <CardContent>
          <Box component="form" onSubmit={onAddPasskey}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{ alignItems: { sm: "center" } }}
            >
              <Box sx={{ flex: 1 }}>
                <TextField
                  fullWidth
                  label="Passkey Name (e.g. My MacBook)"
                  value={formState.passkeyName}
                  onChange={(e) =>
                    onFormChange({ passkeyName: e.target.value })
                  }
                  required
                />
              </Box>
              <Box sx={{ width: { xs: "100%", sm: 180 } }}>
                <Button
                  type="submit"
                  variant="outlined"
                  fullWidth
                  disabled={isSaving || !formState.passkeyName}
                >
                  Add Passkey
                </Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      {/* Households */}
      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader title="Households" />
        <Divider />
        <CardContent>
          {profile.households.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              You are not a member of any household.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {profile.households.map((household) => (
                <Box
                  key={household.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  <Box>
                    <Typography variant="body1">
                      {household.displayName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {household.slug} ·{" "}
                      {household.role === "owner" ? "Owner" : "Member"}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    onClick={() => setHouseholdToLeave(household)}
                  >
                    Leave
                  </Button>
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={householdToLeave !== null}
        title="Leave household"
        description={
          <>
            Leave <strong>{householdToLeave?.displayName}</strong>? You will
            lose access to its inboxes until an owner invites you again.
          </>
        }
        confirmLabel="Leave household"
        confirmColor="error"
        isLoading={isLeaving}
        onClose={() => setHouseholdToLeave(null)}
        onConfirm={async () => {
          if (!householdToLeave) return;
          setIsLeaving(true);
          const left = await onLeaveHousehold(householdToLeave.slug);
          setIsLeaving(false);
          if (left) setHouseholdToLeave(null);
        }}
      />

      {/* Install Card */}
      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader title="Install the app" />
        <Divider />
        <CardContent>
          {install.status === "installed" && (
            <Typography variant="body2" color="text.secondary">
              You’re using the installed app. Codes are one tap away from your
              home screen.
            </Typography>
          )}
          {install.status === "available" && (
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
              <Typography variant="body2" color="text.secondary">
                Add Mi Casa Su Casa to your home screen to open it like any
                other app and stay signed in.
              </Typography>
              <Button
                variant="contained"
                onClick={() => void install.onInstall()}
              >
                Install
              </Button>
            </Stack>
          )}
          {install.status === "manual" && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Add Mi Casa Su Casa to your home screen to open it like any
                other app and stay signed in.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                On iPhone or iPad: open this page in Safari, tap the Share
                button, then choose <strong>Add to Home Screen</strong>. On
                Android: open the browser menu and choose{" "}
                <strong>Install app</strong> or{" "}
                <strong>Add to Home screen</strong>.
              </Typography>
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Sessions Card */}
      <Card sx={{ mb: 4, borderRadius: 2, overflow: "hidden" }}>
        <CardHeader
          title="Active Sessions"
          slotProps={{ title: { sx: { pr: { xs: 0, sm: 2 } } } }}
          action={
            <Button
              color="error"
              disabled={isSaving || sessions.length <= 1}
              onClick={() => setIsRevokeOthersOpen(true)}
              sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}
            >
              Revoke Others
            </Button>
          }
          sx={{
            alignItems: { xs: "flex-start", sm: "center" },
            flexDirection: { xs: "column", sm: "row" },
            gap: { xs: 1.5, sm: 0 },
            "& .MuiCardHeader-action": {
              alignSelf: { xs: "flex-start", sm: "center" },
              m: 0,
            },
          }}
        />
        <Divider />
        <List disablePadding>
          {sessions.map((session, index) => (
            <Fragment key={session.id}>
              {index > 0 && <Divider />}
              <ListItem
                sx={{
                  alignItems: { xs: "flex-start", sm: "center" },
                  pr: { xs: 2, sm: 11 },
                }}
                secondaryAction={
                  <Button
                    color="error"
                    size="small"
                    onClick={() => setSessionToRevoke(session)}
                    disabled={isSaving}
                    sx={{ top: { xs: 20, sm: "50%" } }}
                  >
                    Revoke
                  </Button>
                }
              >
                <ListItemText
                  primary={`${session.userAgent ? session.userAgent : "Unknown Device"}${session.isCurrent ? " · this device" : ""}`}
                  secondary={
                    <>
                      {session.ipAddress && `IP: ${session.ipAddress} • `}
                      {session.createdAt &&
                        `Created: ${new Date(session.createdAt).toLocaleDateString()}`}
                    </>
                  }
                />
              </ListItem>
            </Fragment>
          ))}
          {sessions.length === 0 && (
            <ListItem>
              <ListItemText primary="No active sessions found." />
            </ListItem>
          )}
        </List>
      </Card>

      <ConfirmDialog
        open={isDisable2FAOpen}
        title="Disable two-factor authentication?"
        description={
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              This will remove the extra verification step from your account.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your current password is still required to confirm the change.
            </Typography>
          </Stack>
        }
        confirmLabel="Disable 2FA"
        confirmColor="error"
        isLoading={isSaving}
        confirmDisabled={!formState.twoFactorPassword}
        onClose={() => setIsDisable2FAOpen(false)}
        onConfirm={handleDisable2FAConfirm}
      />

      <ConfirmDialog
        open={Boolean(sessionToRevoke)}
        title="Revoke session?"
        description={
          sessionToRevoke ? (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                This will sign out
                <strong>{` ${sessionToRevoke.userAgent || "this device"}`}</strong>
                .
              </Typography>
              {sessionToRevoke.ipAddress && (
                <Typography variant="body2" color="text.secondary">
                  IP address: {sessionToRevoke.ipAddress}
                </Typography>
              )}
            </Stack>
          ) : (
            ""
          )
        }
        confirmLabel="Revoke session"
        confirmColor="error"
        isLoading={isSaving}
        onClose={() => setSessionToRevoke(null)}
        onConfirm={handleRevokeSessionConfirm}
      />

      <ConfirmDialog
        open={isRevokeOthersOpen}
        title="Revoke all other sessions?"
        description="All other signed-in devices will be logged out immediately. Your current session will stay active."
        confirmLabel="Revoke others"
        confirmColor="error"
        isLoading={isSaving}
        onClose={() => setIsRevokeOthersOpen(false)}
        onConfirm={handleRevokeOthersConfirm}
      />
    </Container>
  );
}
