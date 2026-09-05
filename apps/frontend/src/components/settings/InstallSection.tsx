import { InstallMobileOutlined } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import type { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { SettingsSection } from "./SettingsSection";

type InstallState = ReturnType<typeof useInstallPrompt>;

export function InstallSection({ install }: { install: InstallState }) {
  return (
    <SettingsSection
      id="app"
      title="Add to your home screen"
      description="Get to your codes in one tap and stay signed in, like a regular app."
    >
      {install.status === "installed" ? (
        <Typography variant="body2">
          You're using the installed app — nothing to do here.
        </Typography>
      ) : install.status === "available" ? (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Typography variant="body2" color="text.secondary">
            Your browser can install this app right now.
          </Typography>
          <Button
            variant="contained"
            startIcon={<InstallMobileOutlined />}
            onClick={() => void install.onInstall()}
          >
            Install
          </Button>
        </Stack>
      ) : (
        <Box>
          <Typography variant="body2" color="text.secondary">
            On iPhone or iPad: open this page in Safari, tap the{" "}
            <strong>Share</strong> button, then{" "}
            <strong>Add to Home Screen</strong>.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            On Android: open the browser menu (⋮) and choose{" "}
            <strong>Add to Home screen</strong> or <strong>Install app</strong>.
          </Typography>
        </Box>
      )}
    </SettingsSection>
  );
}
