import { Alert, Box, Button, Link as MuiLink, TextField } from "@mui/material";
import {
  Link as RouterLink,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { signIn } from "../lib/auth-client";
import type { LoginState, SetupStatus } from "../types";
import { PublicEntryShell } from "./PublicEntryShell";
import { PasswordField } from "./ui";

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
  const navigate = useNavigate();
  // The challenge page finishes the sign-in, so it needs the same ?redirect=
  // this page was opened with. Read off the location rather than the matched
  // route's validated search so the page renders anywhere the router is in
  // context.
  const search = useRouterState({
    select: (state) => state.location.search,
  }) as {
    redirect?: string;
  };
  const [loginState, setLoginState] = useState<LoginState>({
    email: "",
    password: "",
  });
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);

    const nextErrors: typeof fieldErrors = {};
    if (!loginState.email.trim())
      nextErrors.email = "Enter your email address.";
    if (!loginState.password) nextErrors.password = "Enter your password.";
    setFieldErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setIsLoggingIn(true);
    try {
      const { twoFactorRequired } = await signIn(
        loginState.email.trim(),
        loginState.password,
      );
      setLoginState({ email: "", password: "" });
      // An account with two-step verification on has no session yet: the
      // server revoked the one it minted and set a challenge cookie instead.
      // Finish on the challenge page.
      if (twoFactorRequired) {
        void navigate({
          to: "/two-factor",
          search: search.redirect ? { redirect: search.redirect } : {},
        });
        return;
      }
      onLoginSuccess();
    } catch (error) {
      setLoginError(
        error instanceof Error && error.message
          ? error.message
          : "That email and password don't match. Try again.",
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <PublicEntryShell
      eyebrow="Mi Casa Su Casa"
      title="Your family's login codes, in one place."
      description="Sign in to see the latest verification codes for the services your household shares."
    >
      <Box component="form" onSubmit={handleLogin} noValidate>
        <TextField
          margin="normal"
          required
          fullWidth
          id="email"
          label="Email address"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          value={loginState.email}
          error={Boolean(fieldErrors.email)}
          helperText={fieldErrors.email}
          onChange={(e) => {
            setLoginState((current) => ({
              ...current,
              email: e.target.value,
            }));
            if (fieldErrors.email)
              setFieldErrors((f) => ({ ...f, email: undefined }));
          }}
        />
        <PasswordField
          margin="normal"
          required
          fullWidth
          name="password"
          label="Password"
          id="password"
          autoComplete="current-password"
          value={loginState.password}
          error={Boolean(fieldErrors.password)}
          helperText={fieldErrors.password}
          onChange={(e) => {
            setLoginState((current) => ({
              ...current,
              password: e.target.value,
            }));
            if (fieldErrors.password)
              setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          sx={{ mb: 3 }}
        />

        {loginError && (
          <Alert severity="error" sx={{ mb: 3 }} role="alert">
            {loginError}
          </Alert>
        )}

        {setupError && !setupStatus?.isConfigured && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {setupError}
          </Alert>
        )}

        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          disabled={isLoggingIn}
        >
          {isLoggingIn ? "Signing in…" : "Sign in"}
        </Button>

        <Box sx={{ mt: 2, textAlign: "center" }}>
          <MuiLink component={RouterLink} to="/forgot-password">
            Forgot your password?
          </MuiLink>
        </Box>
      </Box>
    </PublicEntryShell>
  );
}
