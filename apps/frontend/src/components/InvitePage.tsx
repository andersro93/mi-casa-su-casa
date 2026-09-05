import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { client, unwrap } from "../lib/api";
import { signOut } from "../lib/auth-client";
import type {
  InvitationAcceptanceState,
  InvitationLookupResponse,
} from "../types";
import { PublicEntryShell } from "./PublicEntryShell";
import { LoadingState, PasswordField } from "./ui";

interface InvitePageProps {
  token: string;
  onAcceptSuccess: (householdSlug: string) => void;
}

const MIN_PASSWORD_LENGTH = 12;
const APP_NAME = "Mi Casa Su Casa";

function roleSentence(role: string, inviter: string) {
  return role === "owner" || role === "admin"
    ? "As an owner you can add services and family members, and review anything that needs a second look."
    : `As a member you'll see the login codes for the services ${inviter} shares with you.`;
}

export function InvitePage({ token, onAcceptSuccess }: InvitePageProps) {
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<InvitationLookupResponse | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [formState, setFormState] = useState<InvitationAcceptanceState>({
    name: "",
    password: "",
  });
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    password?: string;
  }>({});

  const loadInvitation = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await unwrap<InvitationLookupResponse>(
        client.GET("/api/invitations/lookup", {
          // The token travels in a header, not the URL: an invitation link
          // pasted into a chat should not leave the token in a referrer or a
          // proxy's access log.
          params: { header: { "X-Invitation-Token": token } },
        }),
      );
      setLookup(response);
      setAccountExists(response.accountExists);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load invitation",
      );
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadInvitation();
  }, [loadInvitation]);

  async function submitAcceptance(body: { name?: string; password?: string }) {
    setError(null);
    setIsAccepting(true);

    try {
      const response = await unwrap<{ household?: { slug: string } | null }>(
        client.POST("/api/invitations/accept", {
          params: { header: { "X-Invitation-Token": token } },
          body,
        }),
      );

      if (!response.household?.slug) {
        throw new Error("Invitation accepted but no household was returned");
      }

      onAcceptSuccess(response.household.slug);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to accept invitation";
      if (/already exists/i.test(message)) {
        setAccountExists(true);
      }
      setError(message);
      setIsAccepting(false);
    }
  }

  async function handleAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: typeof fieldErrors = {};
    if (!formState.name.trim()) nextErrors.name = "Tell us what to call you.";
    if (formState.password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters — a short sentence works well.`;
    }
    setFieldErrors(nextErrors);
    if (nextErrors.name || nextErrors.password) return;

    await submitAcceptance({
      name: formState.name.trim(),
      password: formState.password,
    });
  }

  function goToSignIn() {
    sessionStorage.setItem("pendingInviteToken", token);
    void navigate({ to: "/login" });
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
    await loadInvitation();
  }

  if (isLoading) {
    return (
      <PublicEntryShell eyebrow={APP_NAME} title="Opening your invitation…">
        <LoadingState variant="detail" label="Loading invitation" />
      </PublicEntryShell>
    );
  }

  if (error && !lookup) {
    return (
      <PublicEntryShell
        eyebrow={APP_NAME}
        title="This invitation isn't available any more."
        description="It may have expired or already been used, or the link may be incomplete. Ask the person who invited you to send a new one."
      >
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button
          variant="outlined"
          fullWidth
          size="large"
          onClick={() => void navigate({ to: "/login", replace: true })}
        >
          Go to sign in
        </Button>
      </PublicEntryShell>
    );
  }

  if (!lookup) {
    return null;
  }

  const { invitation, viewer } = lookup;
  const householdName = lookup.household?.displayName ?? "the household";
  const inviterName = lookup.invitedBy?.name ?? "Someone";

  if (viewer?.emailMatches) {
    return (
      <PublicEntryShell
        eyebrow={APP_NAME}
        title={`Join ${householdName}`}
        description={
          <>
            {inviterName} invited you. You're signed in as{" "}
            <strong>{viewer.email}</strong> — accept to see the household's
            login codes.
          </>
        }
      >
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} role="alert">
            {error}
          </Alert>
        )}
        <Button
          fullWidth
          variant="contained"
          size="large"
          disabled={isAccepting}
          onClick={() => void submitAcceptance({})}
        >
          {isAccepting ? "Joining…" : "Accept invitation"}
        </Button>
      </PublicEntryShell>
    );
  }

  if (viewer && !viewer.emailMatches) {
    return (
      <PublicEntryShell
        eyebrow={APP_NAME}
        title="This invitation is for a different account"
        description={
          <>
            {inviterName} sent this invitation to{" "}
            <strong>{invitation.email}</strong>, but you're signed in as{" "}
            <strong>{viewer.email}</strong>. Sign out to continue with the
            invited address.
          </>
        }
      >
        <Stack spacing={1.5}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
          >
            {isSigningOut ? "Signing out…" : "Sign out and continue"}
          </Button>
          <Button
            variant="text"
            fullWidth
            onClick={() => void navigate({ to: "/" })}
          >
            Stay signed in as {viewer.email}
          </Button>
        </Stack>
      </PublicEntryShell>
    );
  }

  if (accountExists) {
    return (
      <PublicEntryShell
        eyebrow={APP_NAME}
        title={`Welcome back — sign in to join ${householdName}`}
        description={
          <>
            There's already an account for <strong>{invitation.email}</strong>.
            Sign in with it and we'll bring you straight back here.
          </>
        }
      >
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} role="alert">
            {error}
          </Alert>
        )}
        <Button fullWidth variant="contained" size="large" onClick={goToSignIn}>
          Sign in to accept
        </Button>
      </PublicEntryShell>
    );
  }

  return (
    <PublicEntryShell
      eyebrow={APP_NAME}
      title={`${inviterName} invited you to ${householdName}`}
      description={
        <>
          {APP_NAME} is where your household finds the login codes for the
          services it shares — Netflix, streaming, and the like — without
          digging through email. {roleSentence(invitation.role, inviterName)}{" "}
          Create your account to join.
        </>
      }
    >
      <Box component="form" onSubmit={handleAccept} noValidate>
        <TextField
          margin="normal"
          fullWidth
          label="Email address"
          value={invitation.email}
          helperText="This is the address the invitation was sent to."
          slotProps={{ input: { readOnly: true } }}
        />
        <TextField
          margin="normal"
          required
          fullWidth
          id="name"
          label="Your name"
          name="name"
          autoComplete="name"
          autoFocus
          value={formState.name}
          error={Boolean(fieldErrors.name)}
          helperText={
            fieldErrors.name ?? "How the rest of the household will see you."
          }
          onChange={(e) => {
            setFormState((current) => ({ ...current, name: e.target.value }));
            if (fieldErrors.name)
              setFieldErrors((f) => ({ ...f, name: undefined }));
          }}
        />
        <PasswordField
          margin="normal"
          required
          fullWidth
          name="password"
          label="Choose a password"
          id="password"
          autoComplete="new-password"
          value={formState.password}
          error={Boolean(fieldErrors.password)}
          helperText={
            fieldErrors.password ??
            `At least ${MIN_PASSWORD_LENGTH} characters — a short sentence works well.${
              formState.password.length > 0 &&
              formState.password.length < MIN_PASSWORD_LENGTH
                ? ` (${MIN_PASSWORD_LENGTH - formState.password.length} more to go)`
                : ""
            }`
          }
          onChange={(e) => {
            setFormState((current) => ({
              ...current,
              password: e.target.value,
            }));
            if (fieldErrors.password)
              setFieldErrors((f) => ({ ...f, password: undefined }));
          }}
          sx={{ mb: 3 }}
        />

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} role="alert">
            {error}
          </Alert>
        )}

        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          disabled={isAccepting}
        >
          {isAccepting ? "Creating your account…" : "Create account and join"}
        </Button>
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 2, textAlign: "center" }}
        >
          You can turn on two-step verification in Settings afterwards.
        </Typography>
      </Box>
    </PublicEntryShell>
  );
}
