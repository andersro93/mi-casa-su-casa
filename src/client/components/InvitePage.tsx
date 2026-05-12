import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useEffect, useState } from "react";
import type { InvitationAcceptanceState, InvitationSummary } from "../types";
import { fetchJson } from "../utils";

interface InvitePageProps {
  token: string;
  onAcceptSuccess: () => void;
}

export function InvitePage({ token, onAcceptSuccess }: InvitePageProps) {
  const [invitation, setInvitation] = useState<InvitationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [formState, setFormState] = useState<InvitationAcceptanceState>({
    name: "",
    password: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadInvitation() {
      try {
        const response = await fetchJson<{ invitation: InvitationSummary }>(
          `/api/invitations/${token}`,
        );

        if (cancelled) return;

        setInvitation(response.invitation);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load invitation",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadInvitation();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState.name || formState.password.length < 12) {
      setError(
        "Please provide a name and a password of at least 12 characters.",
      );
      return;
    }

    setError(null);
    setIsAccepting(true);

    try {
      await fetchJson(`/api/invitations/${token}/accept`, {
        method: "POST",
        body: JSON.stringify({
          name: formState.name,
          password: formState.password,
        }),
      });

      onAcceptSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to accept invitation",
      );
      setIsAccepting(false);
    }
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <CircularProgress size={60} sx={{ mb: 4 }} />
        <Typography variant="h5" sx={{ fontWeight: "bold" }}>
          Loading invitation…
        </Typography>
      </Box>
    );
  }

  if (error && !invitation) {
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
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => {
                  window.history.replaceState({}, "", "/");
                  window.location.reload();
                }}
              >
                Return to Login
              </Button>
            </CardContent>
          </Card>
        </Box>
      </Container>
    );
  }

  if (!invitation) {
    return null;
  }

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
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: "bold", letterSpacing: 1 }}
            >
              Mi Casa Su Casa
            </Typography>
            <Typography
              variant="h4"
              component="h1"
              gutterBottom
              sx={{ mt: 1, fontWeight: "bold" }}
            >
              Accept Invitation
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              You have been invited to join as a{" "}
              <strong>{invitation.role}</strong>. Please set up your account
              details to continue.
            </Typography>

            <Box component="form" onSubmit={handleAccept} noValidate>
              <TextField
                margin="normal"
                required
                fullWidth
                label="Email Address"
                value={invitation.email}
                disabled
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="name"
                label="Your Name"
                name="name"
                autoComplete="name"
                autoFocus
                value={formState.name}
                onChange={(e) =>
                  setFormState((current) => ({
                    ...current,
                    name: e.target.value,
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
                autoComplete="new-password"
                helperText="Must be at least 12 characters."
                value={formState.password}
                onChange={(e) =>
                  setFormState((current) => ({
                    ...current,
                    password: e.target.value,
                  }))
                }
                sx={{ mb: 3 }}
              />

              {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                  {error}
                </Alert>
              )}

              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={
                  isAccepting ||
                  !formState.name ||
                  formState.password.length < 12
                }
                sx={{ py: 1.5 }}
              >
                {isAccepting ? "Accepting..." : "Accept Invitation"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
