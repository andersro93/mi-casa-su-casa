import { DeleteOutlined, FingerprintOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useId, useState } from "react";
import {
  type PasskeyRecord,
  useAddPasskey,
  useDeletePasskey,
  usePasskeys,
} from "../../queries/settings";
import { formatTimestamp } from "../../utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { LoadingState } from "../ui";
import { SettingsSection } from "./SettingsSection";

interface PasskeysSectionProps {
  onSaved: (message: string) => void;
}

function defaultPasskeyName() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone/.test(ua)) return "My iPhone";
  if (/iPad/.test(ua)) return "My iPad";
  if (/Android/.test(ua)) return "My Android phone";
  if (/Mac/.test(ua)) return "My Mac";
  if (/Windows/.test(ua)) return "My Windows PC";
  return "This device";
}

export function PasskeysSection({ onSaved }: PasskeysSectionProps) {
  const passkeys = usePasskeys();
  const add = useAddPasskey();
  const remove = useDeletePasskey();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<PasskeyRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const openAdd = () => {
    setName(defaultPasskeyName());
    setError(null);
    setAdding(true);
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await add.mutateAsync(name.trim() || defaultPasskeyName());
      setAdding(false);
      onSaved(
        "Passkey added. You can now sign in without a password on this device.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        /not allowed|cancel|abort|timed out/i.test(message)
          ? "That was cancelled. Try again when you're ready."
          : message || "Couldn't add a passkey on this device.",
      );
    }
  };

  const list = passkeys.data ?? [];

  return (
    <SettingsSection
      id="passkeys"
      title="Passkeys"
      description="Sign in with Face ID, Touch ID or your phone's unlock instead of typing a password. Add one on each device you use."
    >
      {passkeys.isLoading ? (
        <LoadingState rows={2} label="Loading passkeys" />
      ) : passkeys.error ? (
        <Alert severity="error">
          {passkeys.error instanceof Error
            ? passkeys.error.message
            : "Couldn't load passkeys."}
        </Alert>
      ) : list.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No passkeys yet on this account.
        </Typography>
      ) : (
        <List disablePadding aria-label="Passkeys">
          {list.map((passkey, index) => (
            <ListItem
              key={passkey.id}
              divider={index < list.length - 1}
              disableGutters
              secondaryAction={
                <IconButton
                  edge="end"
                  aria-label={`Remove passkey ${passkey.name ?? ""}`.trim()}
                  onClick={() => setRemoving(passkey)}
                >
                  <DeleteOutlined />
                </IconButton>
              }
            >
              <ListItemIcon>
                <FingerprintOutlined />
              </ListItemIcon>
              <ListItemText
                primary={passkey.name || "Passkey"}
                secondary={
                  passkey.createdAt
                    ? `Added ${formatTimestamp(new Date(passkey.createdAt).toISOString())}`
                    : undefined
                }
              />
            </ListItem>
          ))}
        </List>
      )}
      <Box sx={{ mt: 2 }}>
        <Button
          variant={list.length === 0 ? "contained" : "outlined"}
          startIcon={<FingerprintOutlined />}
          onClick={openAdd}
        >
          Add a passkey for this device
        </Button>
      </Box>

      <Dialog
        open={adding}
        onClose={add.isPending ? undefined : () => setAdding(false)}
        fullWidth
        maxWidth="xs"
        aria-labelledby={titleId}
      >
        <form onSubmit={handleAdd} noValidate>
          <DialogTitle id={titleId}>Add a passkey</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Your device will ask you to confirm with Face ID, Touch ID, a
                PIN or your phone. Give this passkey a name so you recognise it
                later.
              </Typography>
              <TextField
                autoFocus
                fullWidth
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {error ? <Alert severity="error">{error}</Alert> : null}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button
              onClick={() => setAdding(false)}
              disabled={add.isPending}
              variant="outlined"
              color="inherit"
            >
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={add.isPending}>
              {add.isPending ? "Waiting for your device…" : "Continue"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name || "this passkey"}?`}
        description="You'll need your password (or another passkey) to sign in on that device."
        confirmLabel="Remove passkey"
        loadingLabel="Removing…"
        confirmColor="error"
        isLoading={remove.isPending}
        error={error}
        onClose={() => {
          setRemoving(null);
          setError(null);
        }}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.id);
            setRemoving(null);
            onSaved("Passkey removed.");
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Couldn't remove the passkey.",
            );
          }
        }}
      />
    </SettingsSection>
  );
}
