import { Box, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Less padding, for inside lists/cards. */
  compact?: boolean;
  /** Render without the outlined container (when already inside one). */
  bare?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  bare = false,
}: EmptyStateProps) {
  const content = (
    <Box
      sx={{
        textAlign: "center",
        px: 3,
        py: compact ? 3 : 6,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
      }}
    >
      {icon ? (
        <Box
          aria-hidden
          sx={{
            width: compact ? 44 : 56,
            height: compact ? 44 : 56,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            bgcolor: (theme) =>
              theme.palette.mode === "light" ? "#F3E8D6" : "#3A2E26",
            color: "primary.main",
            mb: 1,
            "& svg": { fontSize: compact ? 22 : 28 },
          }}
        >
          {icon}
        </Box>
      ) : null}
      <Typography variant="h5" component="p">
        {title}
      </Typography>
      {description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 420, textWrap: "pretty" }}
        >
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ mt: 1.5 }}>{action}</Box> : null}
    </Box>
  );

  if (bare) {
    return content;
  }

  return (
    <Paper variant="outlined" sx={{ borderStyle: "dashed" }}>
      {content}
    </Paper>
  );
}
