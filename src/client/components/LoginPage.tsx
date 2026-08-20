import { Alert, Box, Button, Link as MuiLink, TextField } from "@mui/material";
import { authClient } from "@server/auth/client";
import { type FormEvent, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { LoginState, SetupStatus } from "../types";
import { PublicEntryShell } from "./PublicEntryShell";

interface LoginPageProps {
  setupStatus: SetupStatus | null;
  setupError: string | null;
  onLoginSuccess: () => void;
}

export function LoginPage({
  setupStatus,
  setupError,
  onLoginSuccess,
}: LoginPageProps) {
  const [loginState, setLoginState] = useState<LoginState>({
    email: "",
    password: "",
  });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    const { error } = await authClient.signIn.email({
      email: loginState.email,
      password: loginState.password,
      rememberMe: true,
    });

    setIsLoggingIn(false);

    if (error) {
      setLoginError(error.message ?? "Unable to sign in with that account.");
      return;
    }

    setLoginState({ email: "", password: "" });
    onLoginSuccess();
  };

  return (
    <PublicEntryShell
      eyebrow="Mi Casa Su Casa"
      title="Shared verification inbox, without the chaos."
      description="Sign in with your invited household account to see the provider groups you have access to and quickly find the latest verification code."
    >
      <Box component="form" onSubmit={handleLogin} noValidate>
        <TextField
          margin="normal"
          required
          fullWidth
          id="email"
          label="Email Address"
          name="email"
          autoComplete="email"
          autoFocus
          value={loginState.email}
          onChange={(e) =>
            setLoginState((current) => ({
              ...current,
              email: e.target.value,
            }))
          }
        />
        <TextField
          margin="normal"
          required
          fullWidth
          name="password"
          label="Password"
          type="password"
          id="password"
          autoComplete="current-password"
          value={loginState.password}
          onChange={(e) =>
            setLoginState((current) => ({
              ...current,
              password: e.target.value,
            }))
          }
          sx={{ mb: 3 }}
        />

        {loginError && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
            {loginError}
          </Alert>
        )}

        {setupError && !setupStatus?.isConfigured && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
            {setupError}
          </Alert>
        )}

        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          disabled={isLoggingIn}
          sx={{ py: 1.5 }}
        >
          {isLoggingIn ? "Signing in…" : "Sign in"}
        </Button>

        <Box sx={{ mt: 2, textAlign: "center" }}>
          <MuiLink
            component={RouterLink}
            to="/forgot-password"
            underline="hover"
          >
            Forgot your password?
          </MuiLink>
        </Box>
      </Box>
    </PublicEntryShell>
  );
}
