import React, { type FormEvent, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import type { LoginState, SetupStatus } from "../types";
import { authClient } from "@server/auth/client";

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
  const [loginState, setLoginState] = useState<LoginState>({ email: "", password: "" });
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
    <Container component="main" maxWidth="sm">
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          py: 4,
        }}
      >
        <Card elevation={3} sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: "bold", letterSpacing: 1 }}>
              Mi Casa Su Casa
            </Typography>
            <Typography variant="h4" component="h1" gutterBottom sx={{ mt: 1, fontWeight: "bold" }}>
              Shared verification inbox, without the chaos.
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              Sign in with your invited household account to see the provider groups you have access to and quickly find the latest verification code.
            </Typography>

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
                <Alert severity="error" sx={{ mb: 3 }}>
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
                sx={{ py: 1.5 }}
              >
                {isLoggingIn ? "Signing in…" : "Sign in"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
