import { Alert, Box, Button, TextField } from "@mui/material";
import { type FormEvent, useState } from "react";
import type { CreateHouseholdFormState, HouseholdSummary } from "../types";
import { fetchJson } from "../utils";
import { PublicEntryShell } from "./PublicEntryShell";

interface CreateHouseholdPageProps {
  onCreated: (household: HouseholdSummary) => void;
}

export function CreateHouseholdPage({ onCreated }: CreateHouseholdPageProps) {
  const [formState, setFormState] = useState<CreateHouseholdFormState>({
    displayName: "",
    slug: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsCreating(true);

    try {
      const response = await fetchJson<{ household: HouseholdSummary }>(
        "/api/households",
        {
          method: "POST",
          body: JSON.stringify(formState),
        },
      );

      onCreated(response.household);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create household",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <PublicEntryShell
      eyebrow="Create your household"
      title="You need a household to continue."
      description="Pick the household name your members will see and the immutable slug used in URLs and inbound email addresses."
    >
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <TextField
          margin="normal"
          required
          fullWidth
          label="Household name"
          value={formState.displayName}
          onChange={(e) =>
            setFormState((current) => ({
              ...current,
              displayName: e.target.value,
            }))
          }
        />
        <TextField
          margin="normal"
          required
          fullWidth
          label="Household slug"
          helperText="Lowercase letters, numbers, and hyphens only. This cannot be changed later."
          value={formState.slug}
          onChange={(e) =>
            setFormState((current) => ({
              ...current,
              slug: e.target.value.toLowerCase(),
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
            isCreating ||
            !formState.displayName.trim() ||
            !formState.slug.trim()
          }
          sx={{ py: 1.5 }}
        >
          {isCreating ? "Creating household…" : "Create household"}
        </Button>
      </Box>
    </PublicEntryShell>
  );
}
