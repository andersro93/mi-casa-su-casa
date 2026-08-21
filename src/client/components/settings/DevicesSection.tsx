import { DevicesOutlined } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import {
  useRevokeOtherSessions,
  useRevokeSession,
} from "../../queries/settings";
import type { AccountSession } from "../../types";
import { describeUserAgent, formatRelativeTime } from "../../utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { SettingsSection } from "./SettingsSection";

interface DevicesSectionProps {
  sessions: AccountSession[];
  onSaved: (message: string) => void;
}

export function DevicesSection({ sessions, onSaved }: DevicesSectionProps) {
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [target, setTarget] = useState<AccountSession | "others" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = sessions.filter((s) => !s.isCurrent);
  const sorted = [...sessions].sort(
    (a, b) => Number(b.isCurrent) - Number(a.isCurrent),
  );

  return (
    <SettingsSection
      id="devices"
      title="Signed-in devices"
      description="Everywhere you're currently signed in. If you don't recognise one, sign it out."
    >
      <List disablePadding aria-label="Signed-in devices">
        {sorted.map((session, index) => (
          <ListItem
            key={session.id}
            divider={index < sorted.length - 1}
            disableGutters
            secondaryAction={
              session.isCurrent ? null : (
                <Button
                  size="small"
                  color="inherit"
                  variant="outlined"
                  onClick={() => setTarget(session)}
                  disabled={revoke.isPending}
                >
                  Sign out
                </Button>
              )
            }
          >
            <ListItemIcon>
              <DevicesOutlined />
            </ListItemIcon>
            <ListItemText
              primary={
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <span>{describeUserAgent(session.userAgent)}</span>
                  {session.isCurrent ? (
                    <Chip size="small" color="primary" label="This device" />
                  ) : null}
                </Stack>
              }
              secondary={[
                session.updatedAt
                  ? `Last active ${formatRelativeTime(session.updatedAt)}`
                  : null,
                session.ipAddress ? `from ${session.ipAddress}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          </ListItem>
        ))}
      </List>
      {others.length > 0 ? (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setTarget("others")}
            disabled={revokeOthers.isPending}
          >
            Sign out everywhere else
          </Button>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Only this device is signed in.
        </Typography>
      )}

      <ConfirmDialog
        open={Boolean(target)}
        title={
          target === "others"
            ? "Sign out everywhere else?"
            : "Sign out this device?"
        }
        description={
          target === "others"
            ? `${others.length} other ${others.length === 1 ? "device" : "devices"} will be signed out. This one stays signed in.`
            : "That device will have to sign in again."
        }
        confirmLabel={target === "others" ? "Sign out others" : "Sign out"}
        loadingLabel="Signing out…"
        confirmColor="error"
        isLoading={revoke.isPending || revokeOthers.isPending}
        error={error}
        onClose={() => {
          setTarget(null);
          setError(null);
        }}
        onConfirm={async () => {
          try {
            if (target === "others") await revokeOthers.mutateAsync();
            else if (target) await revoke.mutateAsync(target.id);
            setTarget(null);
            onSaved(
              target === "others"
                ? "Signed out everywhere else."
                : "Device signed out.",
            );
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Couldn't sign out that device.",
            );
          }
        }}
      />
    </SettingsSection>
  );
}
