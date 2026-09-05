import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
} from "@mui/material";
import { useState } from "react";
import type { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { useAccountSettings } from "../../queries/settings";
import type { HouseholdSummary } from "../../types";
import { ErrorState, LoadingState, PageHeader } from "../ui";
import { DevicesSection } from "./DevicesSection";
import { HouseholdsSection } from "./HouseholdsSection";
import { InstallSection } from "./InstallSection";
import { PasskeysSection } from "./PasskeysSection";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";
import { TwoStepSection } from "./TwoStepSection";

interface AccountSettingsPageProps {
  install: ReturnType<typeof useInstallPrompt>;
  onHouseholdLeft: (household: HouseholdSummary) => void;
}

const NAV = [
  { id: "profile", label: "Profile" },
  { id: "passkeys", label: "Passkeys" },
  { id: "password", label: "Password" },
  { id: "two-step", label: "Two-step verification" },
  { id: "devices", label: "Signed-in devices" },
  { id: "app", label: "Home screen" },
  { id: "households", label: "Households" },
];

/** Account settings: grouped, with passkeys (the easy sign-in) first among security options. */
export function AccountSettingsPage({
  install,
  onHouseholdLeft,
}: AccountSettingsPageProps) {
  const settings = useAccountSettings();
  const [toast, setToast] = useState<string | null>(null);

  let body: React.ReactNode;
  if (settings.isLoading) {
    body = <LoadingState variant="detail" label="Loading your settings" />;
  } else if (settings.error || !settings.data) {
    body = (
      <ErrorState
        message={
          settings.error instanceof Error
            ? settings.error.message
            : "Couldn't load your settings."
        }
        onRetry={() => void settings.refetch()}
      />
    );
  } else {
    const { profile, sessions } = settings.data;
    body = (
      <Stack spacing={5}>
        <ProfileSection profile={profile} onSaved={setToast} />
        <PasskeysSection onSaved={setToast} />
        <PasswordSection email={profile.email} onSaved={setToast} />
        <TwoStepSection enabled={profile.twoFactorEnabled} onSaved={setToast} />
        <DevicesSection sessions={sessions} onSaved={setToast} />
        <InstallSection install={install} />
        <HouseholdsSection
          households={profile.households}
          onLeft={onHouseholdLeft}
        />
      </Stack>
    );
  }

  return (
    <Box>
      <PageHeader
        title="Settings"
        description="Your account: how you sign in, which devices are signed in, and the households you belong to."
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "200px minmax(0, 1fr)" },
          gap: 4,
          alignItems: "start",
        }}
      >
        <Paper
          variant="outlined"
          component="nav"
          aria-label="Settings sections"
          sx={{
            display: { xs: "none", md: "block" },
            position: "sticky",
            top: 88,
            p: 1,
          }}
        >
          <List disablePadding dense>
            {NAV.map((item) => (
              <ListItemButton
                key={item.id}
                component="a"
                href={`#${item.id}`}
                sx={{ py: 0.75 }}
              >
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
        <Box sx={{ minWidth: 0 }}>{body}</Box>
      </Box>
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
