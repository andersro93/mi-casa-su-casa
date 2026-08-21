import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useId } from "react";
import type { InvitationDeliveryResponse } from "../../types";
import { CopyButton } from "../ui";

interface InviteResultDialogProps {
  result: InvitationDeliveryResponse | null;
  onClose: () => void;
}

/** After sending: confirm the email went out, or hand over a link to share. */
export function InviteResultDialog({
  result,
  onClose,
}: InviteResultDialogProps) {
  const titleId = useId();
  const open = Boolean(result);
  const email = result?.invitation.email ?? "";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId}>
        {result?.emailSent ? "Invitation sent" : "Share this invitation link"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {result?.emailSent ? (
            <Typography variant="body1">
              We emailed <strong>{email}</strong> a link to join. It's valid for
              a while; you can resend it from the pending list if it gets lost.
            </Typography>
          ) : (
            <>
              <Alert severity="warning">
                The email to <strong>{email}</strong> couldn't be sent
                {result?.emailError ? ` (${result.emailError})` : ""}. Send them
                this link yourself — by message, for example.
              </Alert>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Invitation link"
                  value={result?.inviteUrl ?? ""}
                  slotProps={{ input: { readOnly: true } }}
                  onFocus={(e) => e.target.select()}
                />
                {result?.inviteUrl ? (
                  <CopyButton
                    value={result.inviteUrl}
                    label="Copy link"
                    variant="button"
                    size="medium"
                  />
                ) : null}
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
