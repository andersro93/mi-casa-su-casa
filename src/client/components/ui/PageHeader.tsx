import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  /** Small label above the title, e.g. the household name. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Primary action(s) shown beside the title (below it on phones). */
  action?: ReactNode;
}

/** The one h1 every page starts with. */
export function PageHeader({
  title,
  eyebrow,
  description,
  action,
}: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{
        mb: 3,
        alignItems: { xs: "stretch", sm: "flex-start" },
        justifyContent: "space-between",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {eyebrow ? (
          <Typography
            variant="overline"
            color="text.secondary"
            component="div"
            sx={{ mb: 0.5 }}
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography
          variant="h2"
          component="h1"
          sx={{
            fontSize: { xs: "1.5rem", sm: "1.75rem" },
            textWrap: "balance",
          }}
        >
          {title}
        </Typography>
        {description ? (
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mt: 1, maxWidth: 640, textWrap: "pretty" }}
          >
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? (
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ flexShrink: 0, "& > *": { flex: { xs: 1, sm: "0 0 auto" } } }}
        >
          {action}
        </Stack>
      ) : null}
    </Stack>
  );
}
