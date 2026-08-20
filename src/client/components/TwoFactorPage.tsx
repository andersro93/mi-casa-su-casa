import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Link as MuiLink,
  Switch,
  TextField,
} from "@mui/material";
import { authClient } from "@server/auth/client";
import { type FormEvent, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { PublicEntryShell } from "./PublicEntryShell";

interface TwoFactorPageProps {
  onVerified: () => void;
}

export function TwoFactorPage({ onVerified }: TwoFactorPageProps) {
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const trimmed = code.trim();
    const result = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({
          code: trimmed,
          trustDevice,
        })
      : await authClient.twoFactor.verifyTotp({ code: trimmed, trustDevice });

    setIsSubmitting(false);

    if (result.error) {
      setError(
        result.error.message ??
          (useBackupCode
            ? "That backup code was not accepted."
            : "That code was not accepted. Codes change every 30 seconds."),
      );
      return;
    }

    onVerified();
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
        />
        <FormControlLabel
          control={
            <Switch
              checked={trustDevice}
              onChange={(event) => setTrustDevice(event.target.checked)}
            />
          }
          label="Trust this device for 30 days"
          sx={{ mb: 2 }}
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
