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
import { type FormEvent, Fragment } from "react";
import type {
  AccountProfile,
  AccountSession,
  AccountSettingsFormState,
} from "../types";

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
  onDisable2FA: () => void;
  onAddPasskey: (e: FormEvent<HTMLFormElement>) => void;
  onRevokeSession: (sessionId: string) => void;
  onRevokeOtherSessions: () => void;
  isSaving: boolean;
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
  onAddPasskey,
  onRevokeSession,
  onRevokeOtherSessions,
  isSaving,
}: SettingsViewProps) {
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

  return (
    <Container maxWidth="md" disableGutters>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: "bold" }}>
          Account Settings
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your profile, password, two-factor authentication, passkeys,
          and active sessions.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          {error}
        </Alert>
      )}

      {/* Profile Card */}
      <Card sx={{ mb: 4, borderRadius: 2 }}>
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
      <Card sx={{ mb: 4, borderRadius: 2 }}>
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

      <Card sx={{ mb: 4, borderRadius: 2 }}>
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
      <Card sx={{ mb: 4, borderRadius: 2 }}>
        <CardHeader title="Two-Factor Authentication" />
        <Divider />
        <CardContent>
          {profile.twoFactorEnabled ? (
            <Box
              component="form"
              onSubmit={(e) => {
                e.preventDefault();
                onDisable2FA();
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
                    type="submit"
                    variant="outlined"
                    color="error"
                    disabled={isSaving || !formState.twoFactorPassword}
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
      <Card sx={{ mb: 4, borderRadius: 2 }}>
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

      {/* Sessions Card */}
      <Card sx={{ mb: 4, borderRadius: 2 }}>
        <CardHeader
          title="Active Sessions"
          action={
            <Button
              color="error"
              disabled={isSaving || sessions.length <= 1}
              onClick={onRevokeOtherSessions}
            >
              Revoke Others
            </Button>
          }
        />
        <Divider />
        <List disablePadding>
          {sessions.map((session, index) => (
            <Fragment key={session.id}>
              {index > 0 && <Divider />}
              <ListItem
                secondaryAction={
                  <Button
                    color="error"
                    size="small"
                    onClick={() => onRevokeSession(session.id)}
                    disabled={isSaving}
                  >
                    Revoke
                  </Button>
                }
              >
                <ListItemText
                  primary={
                    session.userAgent ? session.userAgent : "Unknown Device"
                  }
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
    </Container>
  );
}
