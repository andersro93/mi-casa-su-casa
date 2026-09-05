import {
  Alert,
  Box,
  Button,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useState } from "react";
import { client, unwrap } from "../lib/api";
import type { SetupFormState } from "../types";
import { suggestHouseholdSlug } from "../utils";
import {
  describeSlugProblem,
  HouseholdAddressField,
} from "./HouseholdAddressField";
import { PublicEntryShell } from "./PublicEntryShell";
import { PasswordField } from "./ui";

interface SetupPageProps {
  onSetupComplete: () => void;
  onSetupError: (error: string) => void;
  setupError: string | null;
  emailDomain?: string | null;
}

const MIN_PASSWORD_LENGTH = 12;
const EMPTY_FORM: SetupFormState = {
  email: "",
  name: "",
  password: "",
  householdName: "",
  householdSlug: "",
  setupSecret: "",
};

export function SetupPage({
  onSetupComplete,
  onSetupError,
  setupError,
  emailDomain = null,
}: SetupPageProps) {
  const [form, setForm] = useState<SetupFormState>(EMPTY_FORM);
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isCompletingSetup, setIsCompletingSetup] = useState(false);

  const problems = {
    householdName: form.householdName.trim()
      ? null
      : "Give your household a name.",
    householdSlug: describeSlugProblem(form.householdSlug),
    email: /\S+@\S+\.\S+/.test(form.email.trim())
      ? null
      : "Enter the owner email address (the OWNER_EMAIL you configured).",
    name: form.name.trim() ? null : "Enter your name.",
    password:
      form.password.length >= MIN_PASSWORD_LENGTH
        ? null
        : `Use at least ${MIN_PASSWORD_LENGTH} characters — a short sentence works well.`,
    setupSecret: form.setupSecret ? null : "Enter the setup secret.",
  };
  const hasProblems = Object.values(problems).some(Boolean);
  const show = (key: keyof typeof problems) =>
    submitted && problems[key] ? problems[key] : undefined;

  const update = (patch: Partial<SetupFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const handleSetupComplete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasProblems) return;
    setIsCompletingSetup(true);

    try {
      await unwrap<{ member: { email: string } }>(
        client.POST("/api/setup/complete", {
          body: {
            ...form,
            email: form.email.trim(),
            name: form.name.trim(),
            householdName: form.householdName.trim(),
          },
        }),
      );
      setForm(EMPTY_FORM);
      onSetupComplete();
    } catch (error) {
      onSetupError(
        error instanceof Error ? error.message : "Unable to complete setup",
      );
    } finally {
      setIsCompletingSetup(false);
    }
  };

  return (
    <PublicEntryShell
      eyebrow="First-run setup"
      title="Set up your household inbox"
      description="One-time setup for this deployment: name the household, create the owner account, and confirm with the setup secret you configured."
    >
      <Box component="form" onSubmit={handleSetupComplete} noValidate>
        <Stack spacing={1}>
          <Typography variant="h5" component="h2">
            Your household
          </Typography>
          <TextField
            margin="normal"
            required
            fullWidth
            autoFocus
            label="Household name"
            placeholder="e.g. The Olsens"
            value={form.householdName}
            error={Boolean(show("householdName"))}
            helperText={
              show("householdName") ?? "What your family will see in the app."
            }
            onChange={(e) => {
              const householdName = e.target.value;
              setForm((current) => ({
                ...current,
                householdName,
                householdSlug: slugEdited
                  ? current.householdSlug
                  : suggestHouseholdSlug(householdName),
              }));
            }}
          />
          <HouseholdAddressField
            margin="normal"
            required
            fullWidth
            value={form.householdSlug}
            emailDomain={emailDomain}
            showError={submitted}
            onChange={(householdSlug) => {
              setSlugEdited(true);
              update({ householdSlug });
            }}
          />
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Stack spacing={1}>
          <Typography variant="h5" component="h2">
            Your account
          </Typography>
          <TextField
            margin="normal"
            required
            fullWidth
            type="email"
            inputMode="email"
            autoComplete="email"
            label="Owner email"
            value={form.email}
            error={Boolean(show("email"))}
            helperText={
              show("email") ??
              "Must match the OWNER_EMAIL configured for this deployment."
            }
            onChange={(e) => update({ email: e.target.value })}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            autoComplete="name"
            label="Your name"
            value={form.name}
            error={Boolean(show("name"))}
            helperText={show("name")}
            onChange={(e) => update({ name: e.target.value })}
          />
          <PasswordField
            margin="normal"
            required
            fullWidth
            autoComplete="new-password"
            label="Choose a password"
            value={form.password}
            error={Boolean(show("password"))}
            helperText={
              show("password") ??
              `At least ${MIN_PASSWORD_LENGTH} characters — a short sentence works well.`
            }
            onChange={(e) => update({ password: e.target.value })}
          />
        </Stack>

        <Divider sx={{ my: 3 }} />

        <PasswordField
          margin="normal"
          required
          fullWidth
          autoComplete="off"
          label="Setup secret"
          value={form.setupSecret}
          error={Boolean(show("setupSecret"))}
          helperText={
            show("setupSecret") ??
            "The SETUP_SECRET you set when deploying. It is only used once."
          }
          onChange={(e) => update({ setupSecret: e.target.value })}
          sx={{ mb: 3 }}
        />

        {setupError && (
          <Alert severity="error" sx={{ mb: 3 }} role="alert">
            {setupError}
          </Alert>
        )}

        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          disabled={isCompletingSetup}
        >
          {isCompletingSetup ? "Setting up…" : "Complete setup"}
        </Button>
      </Box>
    </PublicEntryShell>
  );
}
