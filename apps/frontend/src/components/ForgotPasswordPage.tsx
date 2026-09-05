import { Alert, Box, Button, Link as MuiLink, TextField } from "@mui/material";
import { authClient } from "@server/auth/client";
import { Link as RouterLink } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { PublicEntryShell } from "./PublicEntryShell";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: requestError } = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setIsSubmitting(false);

    if (requestError) {
      setError(requestError.message ?? "Unable to request a password reset.");
      return;
    }

    setSubmitted(true);
  };

  return (
    <PublicEntryShell
      eyebrow="Mi Casa Su Casa"
      title="Forgot your password?"
      description="Enter the email address of your household account. If it exists, we will send a link to choose a new password."
    >
      {submitted ? (
        <Alert severity="success" sx={{ borderRadius: 2, mb: 3 }}>
          If an account exists for {email.trim()}, a reset link is on its way.
          The link is valid for one hour.
        </Alert>
      ) : (
        <Box component="form" onSubmit={handleSubmit} noValidate>
          <TextField
            margin="normal"
            required
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            disabled={isSubmitting || !email.trim()}
            sx={{ py: 1.5 }}
          >
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </Box>
      )}

      <Box sx={{ mt: 3, textAlign: "center" }}>
        <MuiLink component={RouterLink} to="/login" underline="hover">
          Back to sign in
        </MuiLink>
      </Box>
    </PublicEntryShell>
  );
}
