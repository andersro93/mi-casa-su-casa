import {
  Alert,
  Box,
  Button,
  Collapse,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useState } from "react";
import { useUpdateProfile } from "../../queries/settings";
import type { AccountProfile } from "../../types";
import { SettingsSection } from "./SettingsSection";

interface ProfileSectionProps {
  profile: AccountProfile;
  onSaved: (message: string) => void;
}

export function ProfileSection({ profile, onSaved }: ProfileSectionProps) {
  const [name, setName] = useState(profile.name);
  const [image, setImage] = useState(profile.image ?? "");
  const [showAdvanced, setShowAdvanced] = useState(Boolean(profile.image));
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateProfile();
  const dirty =
    name.trim() !== profile.name || image.trim() !== (profile.image ?? "");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    try {
      await update.mutateAsync({ name: name.trim(), image: image.trim() });
      onSaved("Profile saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save your profile.",
      );
    }
  };

  return (
    <SettingsSection
      id="profile"
      title="Profile"
      description="How the rest of the household sees you."
    >
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={2}>
          <TextField
            label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            fullWidth
            error={Boolean(error) && !name.trim()}
          />
          <TextField
            label="Email"
            value={profile.email}
            fullWidth
            slotProps={{ input: { readOnly: true } }}
            helperText="Your sign-in address. Ask the household owner to re-invite you if it needs to change."
          />
          <Box>
            <Button
              size="small"
              variant="text"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              {showAdvanced
                ? "Hide picture link"
                : "Add a picture link (optional)"}
            </Button>
            <Collapse in={showAdvanced}>
              <TextField
                sx={{ mt: 1 }}
                label="Picture link"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                fullWidth
                placeholder="https://…"
                helperText="A link to an image to use as your avatar."
              />
            </Collapse>
          </Box>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Box>
            <Button
              type="submit"
              variant="contained"
              disabled={update.isPending || !dirty}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Household:{" "}
            {profile.households.map((h) => h.displayName).join(", ") ||
              "none yet"}
          </Typography>
        </Stack>
      </Box>
    </SettingsSection>
  );
}
