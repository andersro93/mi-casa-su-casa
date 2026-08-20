import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Container,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import type { HouseholdSettings, HouseholdSettingsFormState } from "../types";

interface HouseholdSettingsViewProps {
  household: HouseholdSettings | null;
  isLoading: boolean;
  error: string | null;
  formState: HouseholdSettingsFormState;
  onFormChange: (update: Partial<HouseholdSettingsFormState>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
}

export function HouseholdSettingsView({
  household,
  isLoading,
  error,
  formState,
  onFormChange,
  onSave,
  isSaving,
}: HouseholdSettingsViewProps) {
  if (isLoading && !household) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!household) {
    return (
      <Alert severity="error">
        {error || "Unable to load household settings"}
      </Alert>
    );
  }

  return (
    <Container maxWidth="md" disableGutters>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: "bold" }}>
          Household Settings
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Review your household details, rename the household, and see its
          current plan.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 2 }}>
        <CardHeader title="Household details" />
        <Divider />
        <CardContent>
          <Box component="form" onSubmit={onSave}>
            <Stack spacing={2}>
              <TextField
                fullWidth
                label="Household slug"
                value={household.slug}
                disabled
              />
              <TextField
                fullWidth
                label="Household email address"
                value={
                  household.emailAddress ??
                  "Not configured — set EMAIL_DOMAIN on the Worker"
                }
                helperText="Give this address to the services that send verification codes."
                disabled
              />
              <TextField
                fullWidth
                label="Household name"
                value={formState.displayName}
                onChange={(event) =>
                  onFormChange({ displayName: event.target.value })
                }
                required
              />
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={isSaving || !formState.displayName.trim()}
                >
                  Save Household Name
                </Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
