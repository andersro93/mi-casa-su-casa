import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useState } from "react";
import type { SetupFormState } from "../types";
import { fetchJson } from "../utils";

interface SetupPageProps {
  onSetupComplete: () => void;
  onSetupError: (error: string) => void;
  setupError: string | null;
}

export function SetupPage({
  onSetupComplete,
  onSetupError,
  setupError,
}: SetupPageProps) {
  const [setupFormState, setSetupFormState] = useState<SetupFormState>({
    email: "",
    name: "",
    password: "",
    householdName: "",
    householdSlug: "",
    setupSecret: "",
  });
  const [isCompletingSetup, setIsCompletingSetup] = useState(false);

  const handleSetupComplete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCompletingSetup(true);

    try {
      await fetchJson<{ member: { email: string } }>("/api/setup/complete", {
        method: "POST",
        body: JSON.stringify(setupFormState),
      });

      setSetupFormState({
        email: "",
        name: "",
        password: "",
        householdName: "",
        householdSlug: "",
        setupSecret: "",
      });

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
              First-run setup
            </Typography>
            <Typography
              variant="h4"
              component="h1"
              gutterBottom
              sx={{ mt: 1, fontWeight: "bold" }}
            >
              Finish setting up your household inbox.
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              Create the initial owner account after your Cloudflare deployment
              completes. This screen closes automatically after the first
              successful setup.
            </Typography>

            <Alert severity="info" sx={{ mb: 4, borderRadius: 2 }}>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: "bold", mb: 0.5 }}
              >
                What you need
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                <li>
                  <Typography variant="body2">
                    The owner email configured as <code>OWNER_EMAIL</code>
                  </Typography>
                </li>
                <li>
                  <Typography variant="body2">
                    Your one-time <code>SETUP_SECRET</code>
                  </Typography>
                </li>
                <li>
                  <Typography variant="body2">
                    A strong password for the initial owner account
                  </Typography>
                </li>
              </Box>
            </Alert>

            <Box component="form" onSubmit={handleSetupComplete} noValidate>
              <TextField
                margin="normal"
                required
                fullWidth
                id="setup-household-name"
                label="Household name"
                name="setup-household-name"
                value={setupFormState.householdName}
                onChange={(e) =>
                  setSetupFormState((current) => ({
                    ...current,
                    householdName: e.target.value,
                  }))
                }
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="setup-household-slug"
                label="Household slug"
                name="setup-household-slug"
                helperText="Lowercase letters, numbers, and hyphens only."
                value={setupFormState.householdSlug}
                onChange={(e) =>
                  setSetupFormState((current) => ({
                    ...current,
                    householdSlug: e.target.value.toLowerCase(),
                  }))
                }
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="setup-email"
                label="Owner email"
                name="setup-email"
                autoComplete="email"
                value={setupFormState.email}
                onChange={(e) =>
                  setSetupFormState((current) => ({
                    ...current,
                    email: e.target.value,
                  }))
                }
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="setup-name"
                label="Owner display name"
                name="setup-name"
                autoComplete="name"
                value={setupFormState.name}
                onChange={(e) =>
                  setSetupFormState((current) => ({
                    ...current,
                    name: e.target.value,
                  }))
                }
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="setup-password"
                label="Password"
                type="password"
                id="setup-password"
                autoComplete="new-password"
                value={setupFormState.password}
                onChange={(e) =>
                  setSetupFormState((current) => ({
                    ...current,
                    password: e.target.value,
                  }))
                }
                slotProps={{ htmlInput: { minLength: 12 } }}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="setup-secret"
                label="Setup secret"
                type="password"
                id="setup-secret"
                autoComplete="off"
                value={setupFormState.setupSecret}
                onChange={(e) =>
                  setSetupFormState((current) => ({
                    ...current,
                    setupSecret: e.target.value,
                  }))
                }
                sx={{ mb: 3 }}
              />

              {setupError && (
                <Alert severity="error" sx={{ mb: 3 }}>
                  {setupError}
                </Alert>
              )}

              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isCompletingSetup}
                sx={{ py: 1.5 }}
              >
                {isCompletingSetup ? "Creating owner…" : "Complete setup"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
