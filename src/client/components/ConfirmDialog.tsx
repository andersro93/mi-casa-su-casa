import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";

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
  confirmDisabled?: boolean;
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
  confirmDisabled = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={isLoading ? undefined : onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {typeof description === "string" ? (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        ) : (
          description
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          onClick={() => void onConfirm()}
          color={confirmColor}
          variant={confirmVariant}
          disabled={isLoading || confirmDisabled}
        >
          {isLoading ? "Working…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
