import { Alert, Box, Button, Divider, Stack, Typography } from "@mui/material";
import { type FormEvent, useState } from "react";
import {
  useChangePassword,
  useRequestPasswordReset,
} from "../../queries/settings";
import { PasswordField } from "../ui";
import { SettingsSection } from "./SettingsSection";

const MIN_PASSWORD_LENGTH = 12;

interface PasswordSectionProps {
  email: string;
  onSaved: (message: string) => void;
}

export function PasswordSection({ email, onSaved }: PasswordSectionProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = useChangePassword();
  const reset = useRequestPasswordReset();
  const [resetSent, setResetSent] = useState(false);

  const problems = {
    current: current ? null : "Enter your current password.",
    next:
      next.length >= MIN_PASSWORD_LENGTH
        ? null
        : `Use at least ${MIN_PASSWORD_LENGTH} characters — a short sentence works well.`,
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (problems.current || problems.next) return;
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setSubmitted(false);
      onSaved("Password changed.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't change the password.",
      );
    }
  };

  return (
    <SettingsSection
      id="password"
      title="Password"
      description="How you sign in. Changing it here keeps your other devices signed in."
    >
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={2}>
          <PasswordField
            label="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            fullWidth
            required
            error={submitted && Boolean(problems.current)}
            helperText={submitted ? problems.current : undefined}
          />
          <PasswordField
            label="New password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            fullWidth
            required
            error={submitted && Boolean(problems.next)}
            helperText={
              submitted && problems.next
                ? problems.next
                : `At least ${MIN_PASSWORD_LENGTH} characters.`
            }
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Box>
            <Button
              type="submit"
              variant="contained"
              disabled={change.isPending}
            >
              {change.isPending ? "Changing…" : "Change password"}
            </Button>
          </Box>
        </Stack>
      </Box>
      <Divider sx={{ my: 3 }} />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Typography variant="body2" color="text.secondary">
          Forgotten it? We can email a reset link to <strong>{email}</strong>.
        </Typography>
        <Button
          variant="outlined"
          color="inherit"
          disabled={reset.isPending || resetSent}
          onClick={async () => {
            try {
              await reset.mutateAsync(email);
              setResetSent(true);
              onSaved("Reset link sent — check your email.");
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Couldn't send the reset email.",
              );
            }
          }}
        >
          {resetSent
            ? "Link sent"
            : reset.isPending
              ? "Sending…"
              : "Email me a reset link"}
        </Button>
      </Stack>
    </SettingsSection>
  );
}
