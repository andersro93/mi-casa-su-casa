import { ChevronRight, InboxOutlined } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  List,
  ListItem,
  ListItemButton,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type { ProviderSummary } from "../../types";
import { buildHouseholdPath } from "../../utils";
import { CopyButton, EmptyState, RelativeTime } from "../ui";
import { CodeDisplay } from "./CodeDisplay";
import { ServiceAvatar } from "./ServiceAvatar";

interface ServiceListProps {
  slug: string;
  providers: ProviderSummary[];
  selectedKey?: string | null;
  /** "cards" shows the latest code on each card (phones); "rows" is the compact desktop list. */
  variant: "cards" | "rows";
  isOwner: boolean;
  onCopied?: (provider: ProviderSummary) => void;
}

export function ServiceList({
  slug,
  providers,
  selectedKey,
  variant,
  isOwner,
  onCopied,
}: ServiceListProps) {
  if (providers.length === 0) {
    return (
      <EmptyState
        icon={<InboxOutlined />}
        title="No services yet"
        description={
          isOwner
            ? "Add a service (like Netflix) and tell us which senders belong to it. Codes show up here the moment they arrive."
            : "When the household owner gives you access to a service, its codes will show up here."
        }
        action={
          isOwner ? (
            <Button
              variant="contained"
              component={RouterLink}
              to={buildHouseholdPath(slug, "/providers")}
            >
              Set up services
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (variant === "rows") {
    return (
      <List
        disablePadding
        aria-label="Services"
        sx={{ display: "grid", gap: 0.5 }}
      >
        {providers.map((provider) => {
          const selected = provider.provider_key === selectedKey;
          return (
            <ListItem key={provider.provider_key} disablePadding>
              <ListItemButton
                component={RouterLink}
                to={buildHouseholdPath(slug, `/inbox/${provider.provider_key}`)}
                selected={selected}
                sx={{ py: 1.25, gap: 1.5, alignItems: "center" }}
              >
                <ServiceAvatar
                  name={provider.display_name}
                  newCount={provider.new_count}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle1" noWrap>
                    {provider.display_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {provider.latest_code ? (
                      <>
                        <Box
                          component="span"
                          sx={{
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                            color:
                              provider.latest_status === "new"
                                ? "text.primary"
                                : "text.secondary",
                          }}
                        >
                          {provider.latest_code}
                        </Box>
                        {" · "}
                      </>
                    ) : null}
                    {provider.latest_received_at ? (
                      <RelativeTime
                        value={provider.latest_received_at}
                        component="span"
                        variant="body2"
                      />
                    ) : (
                      "No messages yet"
                    )}
                  </Typography>
                </Box>
                <ChevronRight color="action" />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    );
  }

  return (
    <Stack
      spacing={1.5}
      component="ul"
      sx={{ listStyle: "none", p: 0, m: 0 }}
      aria-label="Services"
    >
      {providers.map((provider) => {
        const to = buildHouseholdPath(slug, `/inbox/${provider.provider_key}`);
        const hasCode = Boolean(provider.latest_code);
        return (
          <Card
            key={provider.provider_key}
            component="li"
            sx={{ overflow: "visible" }}
          >
            <CardActionArea
              component={RouterLink}
              to={to}
              sx={{ p: 2, pb: hasCode ? 1 : 2 }}
            >
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: "center" }}
              >
                <ServiceAvatar
                  name={provider.display_name}
                  newCount={provider.new_count}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="h5" component="h2" noWrap>
                    {provider.display_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {provider.latest_received_at ? (
                      <>
                        <RelativeTime
                          value={provider.latest_received_at}
                          component="span"
                          variant="body2"
                        />
                        {" · "}
                        {provider.latest_subject ?? "Latest message"}
                      </>
                    ) : (
                      "No messages yet"
                    )}
                  </Typography>
                </Box>
                <ChevronRight color="action" />
              </Stack>
            </CardActionArea>
            {hasCode && provider.latest_code ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  px: 2,
                  pb: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                  >
                    {provider.latest_status === "used"
                      ? "Latest code · used"
                      : provider.latest_status === "expired"
                        ? "Latest code · expired"
                        : "Latest code"}
                  </Typography>
                  <CodeDisplay code={provider.latest_code} size="small" />
                </Box>
                <CopyButton
                  value={provider.latest_code}
                  label={`Copy ${provider.display_name} code`}
                  variant="button"
                  size="small"
                  onCopied={() => onCopied?.(provider)}
                />
              </Stack>
            ) : null}
          </Card>
        );
      })}
    </Stack>
  );
}
