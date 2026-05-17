import {
  CheckCircleOutlined,
  ContentCopyOutlined,
  EmailOutlined,
  HistoryOutlined,
  InboxOutlined,
  MailOutlined,
  MarkEmailReadOutlined,
  ScheduleOutlined,
} from "@mui/icons-material";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Skeleton,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import type { InboxMessage, ProviderSummary } from "../types";
import { formatTimestamp } from "../utils";

const avatarColors = [
  "#6366F1", // Indigo
  "#8B5CF6", // Violet
  "#A855F7", // Purple
  "#EC4899", // Fuchsia
  "#3B82F6", // Blue
  "#0EA5E9", // Light Blue
  "#14B8A6", // Sky
  "#06B6D4", // Cyan
];

function stringToColor(string: string) {
  let hash = 0;
  for (let i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function stringAvatar(name: string) {
  const safeName = name || "?";
  const parts = safeName.split(" ");
  const initials =
    parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : safeName[0];

  return {
    sx: {
      bgcolor: stringToColor(safeName),
      color: "#fff",
      fontWeight: "bold",
    },
    children: initials.toUpperCase(),
  };
}

function getCodePreview(message: InboxMessage) {
  if (message.extracted_code) {
    return `Code ${message.extracted_code}`;
  }

  return "No code detected";
}

function LoadingList({ rows = 4 }: { rows?: number }) {
  const skeletonRows = Array.from({ length: rows }, (_, rowNumber) => rowNumber + 1);

  return (
    <List disablePadding>
      {skeletonRows.map((rowNumber) => (
        <React.Fragment key={`loading-row-${rows}-${rowNumber}`}>
          {rowNumber > 1 && <Divider />}
          <ListItem sx={{ px: 1.5, py: 1.25 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Skeleton variant="circular" width={28} height={28} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Skeleton variant="text" width="58%" height={22} />
                <Skeleton variant="text" width="36%" height={16} />
              </Box>
            </Box>
          </ListItem>
        </React.Fragment>
      ))}
    </List>
  );
}

function LoadingDetail() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Skeleton variant="text" width={72} height={16} />
        <Skeleton variant="text" width="52%" height={32} />
        <Skeleton variant="text" width="42%" height={22} />
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1.25 }}>
          <Skeleton variant="rounded" width={76} height={24} />
          <Skeleton variant="rounded" width={96} height={24} />
          <Skeleton variant="rounded" width={150} height={24} />
        </Box>
      </Paper>
      <Card elevation={0} sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Skeleton variant="text" width={112} height={16} />
          <Skeleton variant="text" width="42%" height={40} />
        </CardContent>
      </Card>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Skeleton variant="text" width={132} height={20} />
        <Skeleton variant="rounded" width="100%" height={120} />
      </Paper>
    </Box>
  );
}

interface InboxViewProps {
  providers: ProviderSummary[];
  selectedProviderKey: string | null;
  onSelectProvider: (key: string) => void;
  messages: InboxMessage[];
  selectedMessageId: string | null;
  onSelectMessage: (id: string) => void;
  isLoadingInbox: boolean;
  isSavingMessage: boolean;
  onStatusChange: (status: InboxMessage["status"]) => void;
}

export function InboxView({
  providers,
  selectedProviderKey,
  onSelectProvider,
  messages,
  selectedMessageId,
  onSelectMessage,
  isLoadingInbox,
  isSavingMessage,
  onStatusChange,
}: InboxViewProps) {
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  const selectedProvider = providers.find(
    (p) => p.provider_key === selectedProviderKey,
  );
  const selectedMessage = messages.find((m) => m.id === selectedMessageId);

  const handleCopyCode = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeId(id);
      setTimeout(() => setCopiedCodeId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const getStatusColor = (status: InboxMessage["status"]) => {
    switch (status) {
      case "new":
        return "success";
      case "used":
        return "default";
      case "expired":
        return "warning";
      default:
        return "default";
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", lg: "row" },
        gap: 2,
        height: "100%",
      }}
    >
      {/* Inboxes Column */}
      <Box
        sx={{
          width: { xs: "100%", lg: 280 },
          flexShrink: 0,
          minWidth: 0,
          order: { xs: selectedMessage ? 3 : 1, lg: 1 },
        }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 1.5,
            gap: 1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: "bold", lineHeight: 1.2 }}
            >
              Inboxes
            </Typography>
            <Typography variant="h6" component="h2" sx={{ fontWeight: "bold" }}>
              Your accessible inboxes
            </Typography>
          </Box>
          <Chip
            size="small"
            label={`${providers.length} total`}
            variant="outlined"
            sx={{ flexShrink: 0 }}
          />
        </Box>

        <Box
          sx={{
            display: { xs: "flex", lg: "none" },
            gap: 1,
            overflowX: "auto",
            pb: 0.5,
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {providers.map((provider) => {
            const isSelected = provider.provider_key === selectedProviderKey;

            return (
              <Chip
                key={provider.provider_key}
                clickable
                onClick={() => onSelectProvider(provider.provider_key)}
                color={isSelected ? "primary" : "default"}
                variant={isSelected ? "filled" : "outlined"}
                label={`${provider.display_name}${provider.new_count > 0 ? ` (${provider.new_count})` : ""}`}
                sx={{ flexShrink: 0, maxWidth: 220 }}
              />
            );
          })}

          {!providers.length && !isLoadingInbox && (
            <Typography variant="body2" color="text.secondary">
              No inboxes yet.
            </Typography>
          )}
        </Box>

        <Paper
          variant="outlined"
          sx={{
            borderRadius: 2,
            overflow: "hidden",
            display: { xs: "none", lg: "block" },
          }}
        >
          {isLoadingInbox ? (
            <LoadingList rows={5} />
          ) : (
            <List disablePadding>
              {providers.map((provider, index) => {
              const isSelected = provider.provider_key === selectedProviderKey;

              return (
                <React.Fragment key={provider.provider_key}>
                  {index > 0 && <Divider />}
                  <ListItem disablePadding>
                    <ListItemButton
                      selected={isSelected}
                      onClick={() => onSelectProvider(provider.provider_key)}
                      sx={{
                        px: 1.5,
                        py: 1.25,
                        alignItems: "stretch",
                        borderLeft: 3,
                        borderColor: isSelected ? "primary.main" : "transparent",
                        bgcolor: isSelected ? "action.selected" : "transparent",
                        transition: "background-color 0.2s ease, border-color 0.2s ease",
                      }}
                    >
                      <ListItemText
                        primary={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1.25,
                              minWidth: 0,
                            }}
                          >
                            <Badge
                              color="primary"
                              badgeContent={provider.new_count}
                              invisible={provider.new_count === 0}
                              sx={{
                                "& .MuiBadge-badge": {
                                  fontWeight: "bold",
                                  minWidth: 18,
                                  height: 18,
                                },
                              }}
                            >
                              <Avatar
                                {...stringAvatar(provider.display_name)}
                                sx={{
                                  ...stringAvatar(provider.display_name).sx,
                                  width: 28,
                                  height: 28,
                                  fontSize: "0.75rem",
                                }}
                              />
                            </Badge>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography
                                variant="subtitle2"
                                sx={{
                                  fontWeight: isSelected ? "bold" : 600,
                                  color: isSelected
                                    ? "primary.main"
                                    : "text.primary",
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {provider.display_name}
                              </Typography>
                              <Box
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1,
                                  mt: 0.25,
                                  flexWrap: "wrap",
                                }}
                              >
                                <Typography variant="caption" color="text.secondary">
                                  {provider.message_count} messages
                                </Typography>
                                {provider.new_count > 0 && (
                                  <Chip
                                    label={`${provider.new_count} new`}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ height: 18 }}
                                  />
                                )}
                              </Box>
                            </Box>
                          </Box>
                        }
                        secondary={
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", mt: 0.75 }}
                          >
                            Latest {formatTimestamp(provider.latest_received_at)}
                          </Typography>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              );
              })}

              {!providers.length && (
                <Box sx={{ p: 3, textAlign: "center" }}>
                  <InboxOutlined
                    sx={{ fontSize: 40, color: "text.disabled", mb: 1.5 }}
                  />
                  <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: "bold" }}
                    gutterBottom
                  >
                    No inboxes yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Once messages arrive for your household services, they&apos;ll
                    appear here.
                  </Typography>
                </Box>
              )}
            </List>
          )}
        </Paper>
      </Box>

      {/* Messages Column */}
      <Box
        sx={{
          width: { xs: "100%", lg: 320 },
          flexShrink: 0,
          minWidth: 0,
          order: { xs: 2, lg: 2 },
        }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 1.5,
            gap: 1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: "bold", lineHeight: 1.2 }}
            >
              Messages
            </Typography>
            <Typography
              variant="h6"
              component="h2"
              sx={{ fontWeight: "bold" }}
              noWrap
            >
              {selectedProvider?.display_name ?? "Choose an inbox"}
            </Typography>
          </Box>
          {selectedProvider && (
            <Chip
              label={`${messages.length} total`}
              size="small"
              variant="outlined"
              sx={{ flexShrink: 0 }}
            />
          )}
        </Box>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          {isLoadingInbox ? (
            <LoadingList rows={6} />
          ) : (
            <List disablePadding>
              {messages.map((message, index) => {
              const isSelected = message.id === selectedMessageId;

              return (
                <React.Fragment key={message.id}>
                  {index > 0 && <Divider />}
                  <ListItem disablePadding>
                    <ListItemButton
                      selected={isSelected}
                      onClick={() => onSelectMessage(message.id)}
                      sx={{
                        px: 1.5,
                        py: 1.25,
                        alignItems: "stretch",
                        borderLeft: 3,
                        borderColor: isSelected ? "primary.main" : "transparent",
                        bgcolor: isSelected ? "action.selected" : "transparent",
                        transition: "background-color 0.2s ease, border-color 0.2s ease",
                      }}
                    >
                      <ListItemText
                        primary={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 1,
                              mb: 0.5,
                            }}
                          >
                            <Typography
                              variant="subtitle2"
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                fontWeight: isSelected ? "bold" : 600,
                                color: isSelected ? "primary.main" : "text.primary",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {message.subject ?? "Untitled message"}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ flexShrink: 0, pl: 1 }}
                            >
                              {formatTimestamp(message.received_at)}
                            </Typography>
                          </Box>
                        }
                        secondary={
                          <Box>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {message.from_header ?? "Unknown sender"}
                            </Typography>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 0.75,
                                mt: 0.75,
                                flexWrap: "wrap",
                              }}
                            >
                              <Chip
                                label={message.status}
                                size="small"
                                color={getStatusColor(message.status)}
                                variant="outlined"
                                sx={{ textTransform: "capitalize", height: 20 }}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {getCodePreview(message)}
                              </Typography>
                            </Box>
                          </Box>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              );
              })}

              {!messages.length && (
                <Box sx={{ p: 3, textAlign: "center" }}>
                  <MailOutlined
                    sx={{ fontSize: 40, color: "text.disabled", mb: 1.5 }}
                  />
                  <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: "bold" }}
                    gutterBottom
                  >
                    {selectedProvider ? "No messages here yet" : "Choose an inbox"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedProvider
                      ? "This inbox is ready for the next verification email."
                      : "Pick an inbox to browse recent verification messages."}
                  </Typography>
                </Box>
              )}
            </List>
          )}
        </Paper>
      </Box>

      {/* Message Detail Column */}
      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          order: { xs: selectedMessage ? 1 : 3, lg: 3 },
        }}
      >
        {isLoadingInbox ? (
          <LoadingDetail />
        ) : selectedMessage ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexDirection: { xs: "column", sm: "row" },
                  gap: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ fontWeight: "bold", lineHeight: 1.2 }}
                  >
                    Details
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: "bold", mb: 0.5 }}>
                    {selectedMessage.subject ?? "Untitled message"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedMessage.from_header ?? "Unknown sender"}
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 0.75,
                      mt: 1.25,
                    }}
                  >
                    <Chip
                      label={selectedMessage.status}
                      size="small"
                      color={getStatusColor(selectedMessage.status)}
                      variant="outlined"
                      sx={{ textTransform: "capitalize" }}
                    />
                    <Chip
                      label={selectedProvider?.display_name ?? "Inbox"}
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label={formatTimestamp(selectedMessage.received_at)}
                      size="small"
                      variant="outlined"
                      icon={<ScheduleOutlined sx={{ fontSize: 14 }} />}
                    />
                  </Box>
                </Box>
              </Box>
            </Paper>

            <Card
              elevation={0}
              sx={{
                border: 1,
                borderColor: "primary.light",
                borderRadius: 2,
                bgcolor: "primary.main",
                color: "primary.contrastText",
              }}
            >
              <CardContent sx={{ p: 2.5 }}>
                <Typography
                  variant="overline"
                  sx={{
                    display: "block",
                    mb: 0.75,
                    fontWeight: "bold",
                    opacity: 0.9,
                  }}
                >
                  Verification code
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    alignItems: { xs: "flex-start", sm: "center" },
                    justifyContent: "space-between",
                    gap: 1.5,
                  }}
                >
                  <Typography
                    variant="h4"
                    sx={{
                      fontWeight: "bold",
                      letterSpacing: { xs: 1, sm: 2 },
                      wordBreak: "break-word",
                    }}
                  >
                    {selectedMessage.extracted_code ?? "No code detected"}
                  </Typography>
                  {selectedMessage.extracted_code && (
                    <Tooltip
                      title={
                        copiedCodeId === selectedMessage.id
                          ? "Copied!"
                          : "Copy code"
                      }
                      placement="top"
                    >
                      <IconButton
                        onClick={() => {
                          if (selectedMessage.extracted_code) {
                            handleCopyCode(
                              selectedMessage.extracted_code,
                              selectedMessage.id,
                            );
                          }
                        }}
                        sx={{
                          color: "primary.contrastText",
                          opacity: 0.9,
                          "&:hover": { opacity: 1 },
                        }}
                      >
                        {copiedCodeId === selectedMessage.id ? (
                          <CheckCircleOutlined />
                        ) : (
                          <ContentCopyOutlined />
                        )}
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </CardContent>
            </Card>

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("new")}
                startIcon={<EmailOutlined />}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                Mark new
              </Button>
              <Button
                variant="outlined"
                size="small"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("used")}
                startIcon={<MarkEmailReadOutlined />}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                Mark used
              </Button>
              <Button
                variant="outlined"
                size="small"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("expired")}
                startIcon={<HistoryOutlined />}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                Mark expired
              </Button>
            </Box>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Typography
                variant="subtitle2"
                sx={{ mb: 1.5, fontWeight: "bold" }}
              >
                Plain-text message
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "monospace",
                  fontSize: "0.875rem",
                  lineHeight: 1.55,
                }}
              >
                {selectedMessage.text_body}
              </Box>
            </Paper>
          </Box>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              p: 5,
              textAlign: "center",
              borderRadius: 2,
              borderStyle: "dashed",
            }}
          >
            <EmailOutlined
              sx={{ fontSize: 56, color: "text.disabled", mb: 2 }}
            />
            <Typography variant="h6" sx={{ fontWeight: "bold", mb: 1 }}>
              {selectedProvider ? "Select a message" : "No message selected"}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {selectedProvider
                ? "Pick a message to see the code, metadata, and full plain-text body."
                : "Choose an inbox first, then select a message to review its verification details."}
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
