import { Alert, Box, Button, Link as MuiLink, TextField } from "@mui/material";
import { authClient } from "@server/auth/client";
import { Link as RouterLink, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { PublicEntryShell } from "./PublicEntryShell";

const MIN_PASSWORD_LENGTH = 12;

export function ResetPasswordPage() {
  // Read off the location rather than the matched route's validated search:
  // the page then renders anywhere the router is in context, and both query
  // parameters are optional either way.
  const search = useRouterState({
    select: (state) => state.location.search,
  }) as {
    token?: string;
    error?: string;
  };
  const token = search.token ?? null;
  const linkError = search.error ?? null;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setIsSubmitting(false);

    if (resetError) {
      setError(
        resetError.message ??
          "Unable to reset the password. The link may have expired.",
      );
      return;
    }

    setDone(true);
  };

  const invalidLink = !token || linkError === "INVALID_TOKEN";

  return (
    <PublicEntryShell
      eyebrow="Mi Casa Su Casa"
      title="Choose a new password"
      description="Pick a new password for your household account. For safety, every other signed-in device is signed out when it changes."
    >
      {done ? (
        <Alert severity="success" sx={{ borderRadius: 2, mb: 3 }}>
          Your password has been updated. You can sign in with it now.
        </Alert>
      ) : invalidLink ? (
        <Alert severity="error" sx={{ borderRadius: 2, mb: 3 }}>
          This password reset link is invalid or has expired. Request a new link
          and try again.
        </Alert>
      ) : (
        <Box component="form" onSubmit={handleSubmit} noValidate>
          <TextField
            margin="normal"
            required
            fullWidth
            type="password"
            id="new-password"
            label="New password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            helperText={`At least ${MIN_PASSWORD_LENGTH} characters`}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            type="password"
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            sx={{ mb: 3 }}
          />

          {error && (
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={isSubmitting}
            sx={{ py: 1.5 }}
          >
            {isSubmitting ? "Updating…" : "Update password"}
          </Button>
        </Box>
      )}

      <Box sx={{ mt: 3, textAlign: "center" }}>
        {invalidLink && !done ? (
          <MuiLink
            component={RouterLink}
            to="/forgot-password"
            underline="hover"
          >
            Request a new reset link
          </MuiLink>
        ) : (
          <MuiLink component={RouterLink} to="/login" underline="hover">
            Back to sign in
          </MuiLink>
        )}
      </Box>
    </PublicEntryShell>
  );
}
