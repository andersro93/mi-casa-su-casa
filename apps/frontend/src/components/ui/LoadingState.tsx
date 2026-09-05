import { Box, Skeleton, Stack } from "@mui/material";

interface LoadingStateProps {
  /** Shape of the content being loaded. */
  variant?: "list" | "cards" | "detail";
  rows?: number;
  /** Accessible description, announced to screen readers. */
  label?: string;
}

/** Skeleton placeholders shaped like the content they stand in for. */
export function LoadingState({
  variant = "list",
  rows = 3,
  label = "Loading…",
}: LoadingStateProps) {
  const items = Array.from({ length: rows }, (_, index) => index);

  return (
    <Box role="status" aria-live="polite" aria-label={label}>
      {variant === "detail" ? (
        <Stack spacing={2}>
          <Skeleton variant="text" width="60%" height={36} />
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={160} />
        </Stack>
      ) : variant === "cards" ? (
        <Stack spacing={2}>
          {items.map((item) => (
            <Skeleton key={item} variant="rounded" height={104} />
          ))}
        </Stack>
      ) : (
        <Stack spacing={0}>
          {items.map((item) => (
            <Box
              key={item}
              sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.5 }}
            >
              <Skeleton variant="circular" width={36} height={36} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="55%" />
                <Skeleton variant="text" width="35%" />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
