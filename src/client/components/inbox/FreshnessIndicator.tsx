import { RefreshOutlined } from "@mui/icons-material";
import {
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useNow } from "../ui";

interface FreshnessIndicatorProps {
  updatedAt: number | undefined;
  isFetching: boolean;
  onRefresh: () => void;
}

/** "Updated 12 s ago" + a refresh button. Polling keeps it honest. */
export function FreshnessIndicator({
  updatedAt,
  isFetching,
  onRefresh,
}: FreshnessIndicatorProps) {
  const now = useNow(5_000);
  const seconds = updatedAt
    ? Math.max(0, Math.round((now - updatedAt) / 1000))
    : null;
  const label =
    seconds === null
      ? "Checking for new codes…"
      : seconds < 10
        ? "Updated just now"
        : seconds < 60
          ? `Updated ${seconds} s ago`
          : `Updated ${Math.round(seconds / 60)} min ago`;

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <Typography
        variant="body2"
        color="text.secondary"
        role="status"
        aria-live="polite"
      >
        {label}
      </Typography>
      <Tooltip title="Check for new codes now">
        <span>
          <IconButton
            size="small"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Check for new codes now"
          >
            {isFetching ? (
              <CircularProgress size={18} />
            ) : (
              <RefreshOutlined fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}
