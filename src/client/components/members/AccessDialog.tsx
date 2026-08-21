import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useId, useState } from "react";
import type { MemberSummary, ProviderOption } from "../../types";

interface AccessDialogProps {
  open: boolean;
  member: MemberSummary | null;
  providers: ProviderOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (grant: string[], revoke: string[]) => void | Promise<void>;
}

/** Pick which services a member can see; saved in one go. */
export function AccessDialog({
  open,
  member,
  providers,
  isSaving,
  error,
  onClose,
  onSave,
}: AccessDialogProps) {
  const titleId = useId();
  const current = new Set(
    member?.providerAccess.map((a) => a.providerKey) ?? [],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSelected(
        new Set(member?.providerAccess.map((a) => a.providerKey) ?? []),
      );
    }
  }, [open, member]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grant = [...selected].filter((key) => !current.has(key));
  const revoke = [...current].filter((key) => !selected.has(key));
  const dirty = grant.length > 0 || revoke.length > 0;

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId}>
        What can {member?.name ?? "they"} see?
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            Tick the services whose codes {member?.name ?? "they"} should see.
          </Typography>
          {providers.length === 0 ? (
            <Typography variant="body2">
              No services yet — add one under Services first.
            </Typography>
          ) : (
            <FormGroup>
              {providers.map((provider) => (
                <FormControlLabel
                  key={provider.id}
                  control={
                    <Checkbox
                      checked={selected.has(provider.provider_key)}
                      onChange={() => toggle(provider.provider_key)}
                    />
                  }
                  label={provider.display_name}
                />
              ))}
            </FormGroup>
          )}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button
          onClick={onClose}
          disabled={isSaving}
          variant="outlined"
          color="inherit"
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={isSaving || !dirty}
          onClick={() => void onSave(grant, revoke)}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
