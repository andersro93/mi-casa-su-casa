import { Alert, Box, Button, Link as MuiLink, TextField } from "@mui/material";
import { Link as RouterLink } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { verifyTwoFactor } from "../lib/auth-client";
import { PublicEntryShell } from "./PublicEntryShell";

interface TwoFactorPageProps {
  onVerified: () => void;
}

export function TwoFactorPage({ onVerified }: TwoFactorPageProps) {
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // One route for both kinds of code: the server recognises a backup
      // code by its shape, so the toggle above only changes the wording.
      await verifyTwoFactor(code.trim());
      onVerified();
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : "";
      setError(
        message ||
          (useBackupCode
            ? "That backup code was not accepted."
            : "That code was not accepted. Codes change every 30 seconds."),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PublicEntryShell
      eyebrow="Mi Casa Su Casa"
      title="Two-factor authentication"
      description={
        useBackupCode
          ? "Enter one of the backup codes you saved when you enabled two-factor authentication. Each code works once."
          : "Enter the 6-digit code from your authenticator app to finish signing in."
      }
    >
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <TextField
          margin="normal"
          required
          fullWidth
          id="two-factor-code"
          label={useBackupCode ? "Backup code" : "Authenticator code"}
          autoComplete="one-time-code"
          inputMode={useBackupCode ? "text" : "numeric"}
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          sx={{ mb: 2 }}
        />

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }} role="alert">
            {error}
          </Alert>
        )}

        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          disabled={isSubmitting || !code.trim()}
          sx={{ py: 1.5 }}
        >
          {isSubmitting ? "Verifying…" : "Verify"}
        </Button>
      </Box>

      <Box
        sx={{
          mt: 3,
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        <MuiLink
          component="button"
          type="button"
          underline="hover"
          onClick={() => {
            setUseBackupCode((current) => !current);
            setCode("");
            setError(null);
          }}
        >
          {useBackupCode ? "Use an authenticator code" : "Use a backup code"}
        </MuiLink>
        <MuiLink component={RouterLink} to="/login" underline="hover">
          Back to sign in
        </MuiLink>
      </Box>
    </PublicEntryShell>
  );
}
