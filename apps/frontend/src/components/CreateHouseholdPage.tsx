import { Alert, Box, Button, TextField } from "@mui/material";
import { type FormEvent, useState } from "react";
import type { CreateHouseholdFormState, HouseholdSummary } from "../types";
import { fetchJson, suggestHouseholdSlug } from "../utils";
import {
  describeSlugProblem,
  HouseholdAddressField,
} from "./HouseholdAddressField";
import { PublicEntryShell } from "./PublicEntryShell";

interface CreateHouseholdPageProps {
  onCreated: (household: HouseholdSummary) => void;
  emailDomain?: string | null;
}

export function CreateHouseholdPage({
  onCreated,
  emailDomain = null,
}: CreateHouseholdPageProps) {
  const [formState, setFormState] = useState<CreateHouseholdFormState>({
    displayName: "",
    slug: "",
  });
  // Once the user edits the address by hand we stop deriving it from the name.
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const nameProblem = formState.displayName.trim()
    ? null
    : "Give your household a name.";
  const slugProblem = describeSlugProblem(formState.slug);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (nameProblem || slugProblem) return;

    setIsCreating(true);
    try {
      const response = await fetchJson<{ household: HouseholdSummary }>(
        "/api/households",
        {
          method: "POST",
          body: JSON.stringify({
            displayName: formState.displayName.trim(),
            slug: formState.slug,
          }),
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
      eyebrow="New household"
      title="Name your household"
      description="A household is the family (or group) that shares streaming and other accounts. Its name becomes the email address where login codes arrive — give that address to Netflix & co. and the codes show up here for everyone you invite."
    >
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <TextField
          margin="normal"
          required
          fullWidth
          autoFocus
          label="Household name"
          placeholder="e.g. The Olsens"
          value={formState.displayName}
          error={submitted && Boolean(nameProblem)}
          helperText={
            submitted && nameProblem
              ? nameProblem
              : "What your family will see in the app."
          }
          onChange={(e) => {
            const displayName = e.target.value;
            setFormState((current) => ({
              displayName,
              slug: slugEdited
                ? current.slug
                : suggestHouseholdSlug(displayName),
            }));
          }}
        />
        <HouseholdAddressField
          margin="normal"
          required
          fullWidth
          value={formState.slug}
          emailDomain={emailDomain}
          showError={submitted}
          onChange={(slug) => {
            setSlugEdited(true);
            setFormState((current) => ({ ...current, slug }));
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
          disabled={isCreating}
        >
          {isCreating ? "Creating household…" : "Create household"}
        </Button>
      </Box>
    </PublicEntryShell>
  );
}
