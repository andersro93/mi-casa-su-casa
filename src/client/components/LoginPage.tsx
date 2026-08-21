import { FingerprintOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Divider,
  Link as MuiLink,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { authClient } from "@server/auth/client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import type { LoginState, SetupStatus } from "../types";
import { PublicEntryShell } from "./PublicEntryShell";
import { PasswordField } from "./ui";

interface LoginPageProps {
  setupStatus: SetupStatus | null;
  setupError: string | null;
  onLoginSuccess: () => void;
}

/** True when the browser can offer passkeys in the email field's autofill. */
export async function supportsPasskeyAutofill(): Promise<boolean> {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        window.PublicKeyCredential &&
        (await window.PublicKeyCredential.isConditionalMediationAvailable?.()),
    );
  } catch {
    return false;
  }
}

const PASSKEY_CANCELLED = /not allowed|timed out|abort|cancel/i;

export function LoginPage({
  setupStatus,
  setupError,
  onLoginSuccess,
}: LoginPageProps) {
  const navigate = useNavigate();
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
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);
  const autofillStarted = useRef(false);
  // The autofill effect runs once but must call the latest finishSignIn.
  const finishSignInRef = useRef<(data: unknown) => void>(() => {});

  const finishSignIn = (data: unknown) => {
    setLoginState({ email: "", password: "" });
    // Accounts with two-factor enabled get no session yet; finish on the
    // challenge page.
    if (
      data &&
      typeof data === "object" &&
      "twoFactorRedirect" in data &&
      (data as { twoFactorRedirect?: boolean }).twoFactorRedirect
    ) {
      navigate("/two-factor");
      return;
    }
    onLoginSuccess();
  };
  finishSignInRef.current = finishSignIn;

  // Offer saved passkeys in the email field's autofill (conditional UI). This
  // never shows a prompt on its own, so failures are silent.
  useEffect(() => {
    if (autofillStarted.current) return;
    autofillStarted.current = true;
    let cancelled = false;
    void (async () => {
      if (!(await supportsPasskeyAutofill())) return;
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (cancelled || !result || result.error) return;
      finishSignInRef.current(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePasskey = async () => {
    setLoginError(null);
    setIsPasskeyPending(true);
    const result = await authClient.signIn.passkey();
    setIsPasskeyPending(false);
    if (!result || result.error) {
      const message = result?.error?.message ?? "";
      setLoginError(
        PASSKEY_CANCELLED.test(message)
          ? "Passkey sign-in was cancelled. You can try again or use your password."
          : message ||
              "Couldn't sign in with a passkey on this device. Use your password instead.",
      );
      return;
    }
    finishSignIn(result.data);
  };

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
    const { data, error } = await authClient.signIn.email({
      email: loginState.email.trim(),
      password: loginState.password,
      rememberMe: true,
    });
    setIsLoggingIn(false);

    if (error) {
      setLoginError(
        error.message ?? "That email and password don't match. Try again.",
      );
      return;
    }

    finishSignIn(data);
  };

  return (
    <PublicEntryShell
      eyebrow="Mi Casa Su Casa"
      title="Your family's login codes, in one place."
      description="Sign in to see the latest verification codes for the services your household shares."
    >
      <Stack spacing={2.5}>
        <Button
          type="button"
          variant="outlined"
          size="large"
          startIcon={<FingerprintOutlined />}
          onClick={handlePasskey}
          disabled={isPasskeyPending || isLoggingIn}
          fullWidth
        >
          {isPasskeyPending
            ? "Waiting for your device…"
            : "Sign in with a passkey"}
        </Button>
        <Divider>
          <Typography variant="body2" color="text.secondary">
            or with your password
          </Typography>
        </Divider>

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
            autoComplete="username webauthn"
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
            disabled={isLoggingIn || isPasskeyPending}
          >
            {isLoggingIn ? "Signing in…" : "Sign in"}
          </Button>

          <Box sx={{ mt: 2, textAlign: "center" }}>
            <MuiLink component={RouterLink} to="/forgot-password">
              Forgot your password?
            </MuiLink>
          </Box>
        </Box>
      </Stack>
    </PublicEntryShell>
  );
}
