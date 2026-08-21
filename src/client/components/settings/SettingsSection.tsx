import { Box, Card, CardContent, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface SettingsSectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/** One anchored group on the settings page. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <Box
      component="section"
      id={id}
      aria-labelledby={`${id}-title`}
      sx={{ scrollMarginTop: 88 }}
    >
      <Typography
        id={`${id}-title`}
        variant="h4"
        component="h2"
        sx={{ mb: 0.5 }}
      >
        {title}
      </Typography>
      {description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 2, maxWidth: 640 }}
        >
          {description}
        </Typography>
      ) : (
        <Box sx={{ mb: 2 }} />
      )}
      <Card>
        <CardContent
          sx={{ p: { xs: 2, sm: 3 }, "&:last-child": { pb: { xs: 2, sm: 3 } } }}
        >
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}
