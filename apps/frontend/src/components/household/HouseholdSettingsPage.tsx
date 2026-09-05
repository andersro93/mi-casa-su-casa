import { MailOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useEffect, useState } from "react";
import {
  useHouseholdSettings,
  useRenameHousehold,
} from "../../queries/household";
import { CopyButton, ErrorState, LoadingState, PageHeader } from "../ui";

interface HouseholdSettingsPageProps {
  slug: string;
  /** Called after a rename so the shell can show the new name immediately. */
  onRenamed: (displayName: string) => void;
}

/** Owner screen: the household's inbox address (the thing you give to services) and its name. */
export function HouseholdSettingsPage({
  slug,
  onRenamed,
}: HouseholdSettingsPageProps) {
  const settings = useHouseholdSettings(slug);
  const rename = useRenameHousehold(slug);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setName(settings.data.displayName);
  }, [settings.data]);

  const handleRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the household a name.");
      return;
    }
    try {
      await rename.mutateAsync(trimmed);
      onRenamed(trimmed);
      setToast("Household renamed.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't rename the household.",
      );
    }
  };

  let body: React.ReactNode;
  if (settings.isLoading) {
    body = <LoadingState variant="detail" label="Loading household settings" />;
  } else if (settings.error || !settings.data) {
    body = (
      <ErrorState
        message={
          settings.error instanceof Error
            ? settings.error.message
            : "Couldn't load household settings."
        }
        onRetry={() => void settings.refetch()}
      />
    );
  } else {
    const household = settings.data;
    body = (
      <Stack spacing={4}>
        <Box component="section" aria-labelledby="inbox-address-title">
          <Typography
            id="inbox-address-title"
            variant="h4"
            component="h2"
            sx={{ mb: 0.5 }}
          >
            Inbox address
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2, maxWidth: 640 }}
          >
            When a service asks for an email address, use this one. Codes sent
            to it show up in the inbox for everyone with access to that service.
          </Typography>
          {household.emailAddress ? (
            <Card
              sx={{
                bgcolor: "primary.main",
                color: "primary.contrastText",
                borderColor: "primary.main",
              }}
            >
              <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  sx={{
                    alignItems: { sm: "center" },
                    justifyContent: "space-between",
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: "center", minWidth: 0 }}
                  >
                    <MailOutlined />
                    <Typography
                      variant="h4"
                      component="p"
                      sx={{ wordBreak: "break-all", fontFamily: "inherit" }}
                    >
                      {household.emailAddress}
                    </Typography>
                  </Stack>
                  <CopyButton
                    value={household.emailAddress}
                    label="Copy address"
                    variant="button"
                    color="inherit"
                    sx={{
                      bgcolor: "background.paper",
                      color: "primary.main",
                      "&:hover": { bgcolor: "background.default" },
                      flexShrink: 0,
                    }}
                  />
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <Alert severity="warning">
              The inbox address isn't available yet: whoever runs this
              deployment still needs to set <code>EMAIL_DOMAIN</code> on the
              Worker. The household's short name is{" "}
              <strong>{household.slug}</strong>, so the address will be{" "}
              <strong>{household.slug}@…</strong> once it is.
            </Alert>
          )}
        </Box>

        <Box component="section" aria-labelledby="household-name-title">
          <Typography
            id="household-name-title"
            variant="h4"
            component="h2"
            sx={{ mb: 0.5 }}
          >
            Household name
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2, maxWidth: 640 }}
          >
            What members see in the app. The inbox address stays the same.
          </Typography>
          <Card>
            <CardContent
              sx={{
                p: { xs: 2, sm: 3 },
                "&:last-child": { pb: { xs: 2, sm: 3 } },
              }}
            >
              <Box component="form" onSubmit={handleRename} noValidate>
                <Stack spacing={2}>
                  <TextField
                    label="Household name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    fullWidth
                    error={Boolean(error)}
                    helperText={error ?? undefined}
                  />
                  <Box>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={
                        rename.isPending ||
                        name.trim() === household.displayName
                      }
                    >
                      {rename.isPending ? "Saving…" : "Save name"}
                    </Button>
                  </Box>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Stack>
    );
  }

  return (
    <Box sx={{ maxWidth: 860 }}>
      <PageHeader
        eyebrow={settings.data?.displayName}
        title="Household settings"
      />
      {body}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
