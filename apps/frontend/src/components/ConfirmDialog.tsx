import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { type ReactNode, useId } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmColor?: "primary" | "error" | "warning" | "info" | "success";
  confirmVariant?: "contained" | "outlined" | "text";
  isLoading?: boolean;
  /** Label shown on the confirm button while `isLoading`, e.g. "Removing…". */
  loadingLabel?: string;
  confirmDisabled?: boolean;
  cancelLabel?: string;
  /** Shown inside the dialog so a failed action is visible where the user is. */
  error?: string | null;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  confirmColor = "primary",
  confirmVariant = "contained",
  isLoading = false,
  loadingLabel = "Working…",
  confirmDisabled = false,
  cancelLabel = "Cancel",
  error = null,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open={open}
      onClose={isLoading ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent id={descriptionId}>
        {typeof description === "string" ? (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        ) : (
          description
        )}
        {error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button
          onClick={onClose}
          disabled={isLoading}
          variant="outlined"
          color="inherit"
        >
          {cancelLabel}
        </Button>
        <Button
          onClick={() => void onConfirm()}
          color={confirmColor}
          variant={confirmVariant}
          disabled={isLoading || confirmDisabled}
        >
          {isLoading ? loadingLabel : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
