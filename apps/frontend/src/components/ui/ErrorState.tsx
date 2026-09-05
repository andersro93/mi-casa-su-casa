import { Alert, AlertTitle, Button } from "@mui/material";
import type { ReactNode } from "react";

interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

/** A visible, actionable error — never just a toast in the corner. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
}: ErrorStateProps) {
  return (
    <Alert
      severity="error"
      role="alert"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    >
      <AlertTitle>{title}</AlertTitle>
      {message}
    </Alert>
  );
}
