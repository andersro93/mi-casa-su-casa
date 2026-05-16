import {
  Alert,
  Box,
  Button,
  CircularProgress,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { InvitationAcceptanceState, InvitationSummary } from "../types";
import { fetchJson } from "../utils";
import { PublicEntryShell } from "./PublicEntryShell";

interface InvitePageProps {
  token: string;
  onAcceptSuccess: (householdSlug: string) => void;
}

export function InvitePage({ token, onAcceptSuccess }: InvitePageProps) {
  const navigate = useNavigate();
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
      const response = await fetchJson<{ household?: { slug: string } | null }>(
        `/api/invitations/${token}/accept`,
        {
          method: "POST",
          body: JSON.stringify({
            name: formState.name,
            password: formState.password,
          }),
        },
      );

      if (!response.household?.slug) {
        throw new Error("Invitation accepted but no household was returned");
      }

      onAcceptSuccess(response.household.slug);
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
      <PublicEntryShell
        eyebrow="Mi Casa Su Casa"
        title="This invitation is not available."
        description="The invite may have expired, already been accepted, or the link may be invalid."
      >
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {error}
        </Alert>
        <Button
          variant="outlined"
          fullWidth
          onClick={() => {
            navigate("/login", { replace: true });
          }}
        >
          Return to Login
        </Button>
      </PublicEntryShell>
    );
  }

  if (!invitation) {
    return null;
  }

  return (
    <PublicEntryShell
      eyebrow="Mi Casa Su Casa"
      title="Accept invitation"
      description={
        <>
          You have been invited to join as a <strong>{invitation.role}</strong>.
          Set up your account details to continue.
        </>
      }
    >
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
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          disabled={
            isAccepting || !formState.name || formState.password.length < 12
          }
          sx={{ py: 1.5 }}
        >
          {isAccepting ? "Accepting…" : "Accept Invitation"}
        </Button>
      </Box>
    </PublicEntryShell>
  );
}
