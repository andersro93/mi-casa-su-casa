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
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import type { InboxMessage, ProviderSummary } from "../types";
import { formatTimestamp, stringAvatar } from "../utils";

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
        gap: 3,
        height: "100%",
      }}
    >
      {/* Providers Column */}
      <Box sx={{ width: { xs: "100%", lg: 320 }, flexShrink: 0, minWidth: 0 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ fontWeight: "bold" }}
        >
          Providers
        </Typography>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            mb: 2,
          }}
        >
          <Typography variant="h5" component="h2" sx={{ fontWeight: "bold" }}>
            Your accessible groups
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
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
                      sx={{ py: 2 }}
                    >
                      <ListItemText
                        primary={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 2,
                              mb: 0.5,
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
                                },
                              }}
                            >
                              <Avatar
                                {...stringAvatar(provider.display_name)}
                                sx={{
                                  ...stringAvatar(provider.display_name).sx,
                                  width: 32,
                                  height: 32,
                                  fontSize: "0.875rem",
                                }}
                              />
                            </Badge>
                            <Typography
                              variant="subtitle1"
                              sx={{
                                fontWeight: isSelected ? "bold" : "medium",
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
                          </Box>
                        }
                        secondary={
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 1,
                              flexWrap: "wrap",
                              color: "text.secondary",
                            }}
                          >
                            <Typography variant="body2">
                              {formatTimestamp(provider.latest_received_at)}
                            </Typography>
                            <Typography variant="body2">
                              {provider.message_count} total
                            </Typography>
                          </Box>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              );
            })}

            {!providers.length && !isLoadingInbox && (
              <Box sx={{ p: 4, textAlign: "center" }}>
                <InboxOutlined
                  sx={{ fontSize: 48, color: "text.disabled", mb: 2 }}
                />
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: "bold" }}
                  gutterBottom
                >
                  No providers yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Once messages arrive for your household services, they’ll
                  appear here.
                </Typography>
              </Box>
            )}
          </List>
        </Paper>
      </Box>

      {/* Messages Column */}
      <Box sx={{ width: { xs: "100%", lg: 360 }, flexShrink: 0, minWidth: 0 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ fontWeight: "bold" }}
        >
          Inbox
        </Typography>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            mb: 2,
          }}
        >
          <Typography variant="h5" component="h2" sx={{ fontWeight: "bold" }}>
            {selectedProvider?.display_name ?? "Choose a provider"}
          </Typography>
          {selectedProvider && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flexShrink: 0 }}
            >
              {messages.length} messages
            </Typography>
          )}
        </Box>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
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
                      sx={{ py: 2 }}
                    >
                      <ListItemText
                        primary={
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: 1,
                              mb: 0.5,
                            }}
                          >
                            <Typography
                              variant="subtitle2"
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                fontWeight: isSelected ? "bold" : "medium",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                pr: 0.5,
                              }}
                            >
                              {message.subject ?? "Untitled message"}
                            </Typography>
                            <Chip
                              label={message.status}
                              size="small"
                              color={getStatusColor(message.status)}
                              variant="outlined"
                              sx={{ textTransform: "capitalize", height: 20 }}
                            />
                          </Box>
                        }
                        secondary={
                          <>
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
                            <Typography
                              variant="caption"
                              color="text.disabled"
                              sx={{
                                mt: 0.5,
                                display: "flex",
                                alignItems: "center",
                                gap: 0.5,
                              }}
                            >
                              <ScheduleOutlined sx={{ fontSize: 14 }} />
                              {formatTimestamp(message.received_at)}
                            </Typography>
                          </>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              );
            })}

            {!messages.length && !isLoadingInbox && (
              <Box sx={{ p: 4, textAlign: "center" }}>
                <MailOutlined
                  sx={{ fontSize: 48, color: "text.disabled", mb: 2 }}
                />
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: "bold" }}
                  gutterBottom
                >
                  No messages here yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Select another provider or wait for the next verification
                  email.
                </Typography>
              </Box>
            )}
          </List>
        </Paper>
      </Box>

      {/* Message Detail Column */}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ fontWeight: "bold" }}
        >
          Message Detail
        </Typography>
        <Typography
          variant="h5"
          component="h2"
          sx={{ fontWeight: "bold", mb: 2, visibility: "hidden" }}
        >
          Detail
        </Typography>

        {selectedMessage ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
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
                <Typography variant="h5" sx={{ fontWeight: "bold", mb: 0.5 }}>
                  {selectedMessage.subject ?? "Untitled message"}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {selectedMessage.from_header ?? "Unknown sender"}
                </Typography>
              </Box>
              <Chip
                label={selectedMessage.status}
                color={getStatusColor(selectedMessage.status)}
                size="small"
                sx={{ textTransform: "capitalize", fontWeight: "bold" }}
              />
            </Box>

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
              <CardContent
                sx={{ p: 4, textAlign: "center", position: "relative" }}
              >
                <Typography
                  variant="overline"
                  sx={{
                    display: "block",
                    mb: 1,
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
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  <Typography
                    variant="h3"
                    sx={{
                      fontWeight: "bold",
                      letterSpacing: { xs: 1, sm: 2 },
                      fontSize: { xs: "2rem", sm: undefined },
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

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              <Button
                variant="outlined"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("new")}
                startIcon={<EmailOutlined />}
              >
                Mark new
              </Button>
              <Button
                variant="outlined"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("used")}
                startIcon={<MarkEmailReadOutlined />}
              >
                Mark used
              </Button>
              <Button
                variant="outlined"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("expired")}
                startIcon={<HistoryOutlined />}
              >
                Mark expired
              </Button>
            </Box>

            <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
              <Typography
                variant="subtitle2"
                sx={{ mb: 2, fontWeight: "bold" }}
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
              p: 6,
              textAlign: "center",
              borderRadius: 2,
              borderStyle: "dashed",
            }}
          >
            <EmailOutlined
              sx={{ fontSize: 64, color: "text.disabled", mb: 2 }}
            />
            <Typography variant="h6" sx={{ fontWeight: "bold", mb: 1 }}>
              Select a message
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Pick the most recent message in a provider group to see the full
              code and body.
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
