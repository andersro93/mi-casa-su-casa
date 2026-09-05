import { Box, Card, CardContent, Container, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { BrandLockup } from "./ui";

const APP_NAME = "Mi Casa Su Casa";

interface PublicEntryShellProps {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function PublicEntryShell({
  eyebrow,
  title,
  description,
  children,
}: PublicEntryShellProps) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        py: { xs: 3, sm: 5, md: 7 },
        px: { xs: 1.5, sm: 2.5, md: 3 },
      }}
    >
      <Container maxWidth="md" disableGutters>
        <Box
          sx={{
            width: "100%",
            maxWidth: 760,
            mx: "auto",
          }}
        >
          <Card
            elevation={3}
            sx={{ borderRadius: { xs: 3, sm: 4 }, overflow: "hidden" }}
          >
            <CardContent sx={{ p: { xs: 3, sm: 4, md: 5 } }}>
              <Box sx={{ mb: 3 }}>
                <BrandLockup size={36} />
              </Box>
              {eyebrow !== APP_NAME ? (
                <Typography
                  variant="overline"
                  color="text.secondary"
                  component="div"
                >
                  {eyebrow}
                </Typography>
              ) : null}
              <Typography
                variant="h4"
                component="h1"
                gutterBottom
                sx={{
                  mt: 1,
                  fontWeight: "bold",
                  fontSize: { xs: "1.9rem", sm: "2.25rem", md: "2.5rem" },
                  lineHeight: 1.15,
                  textWrap: "balance",
                }}
              >
                {title}
              </Typography>
              {description ? (
                <Typography
                  variant="body1"
                  color="text.secondary"
                  sx={{ mb: 4, maxWidth: 56 * 8, textWrap: "pretty" }}
                >
                  {description}
                </Typography>
              ) : null}
              {children}
            </CardContent>
          </Card>
        </Box>
      </Container>
    </Box>
  );
}
