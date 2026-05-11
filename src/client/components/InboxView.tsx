import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import type { InboxMessage, ProviderSummary } from "../types";
import { formatTimestamp } from "../utils";

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
  const selectedProvider = providers.find(
    (p) => p.provider_key === selectedProviderKey,
  );
  const selectedMessage = messages.find((m) => m.id === selectedMessageId);

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
        flexDirection: { xs: "column", md: "row" },
        gap: 3,
        height: "100%",
      }}
    >
      {/* Providers Column */}
      <Box sx={{ width: { xs: "100%", md: 320 }, flexShrink: 0 }}>
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
                              justifyContent: "space-between",
                              mb: 0.5,
                            }}
                          >
                            <Typography
                              variant="subtitle1"
                              sx={{
                                fontWeight: isSelected ? "bold" : "medium",
                              }}
                            >
                              {provider.display_name}
                            </Typography>
                            {provider.new_count > 0 && (
                              <Chip
                                label={`${provider.new_count} new`}
                                size="small"
                                color="primary"
                              />
                            )}
                          </Box>
                        }
                        secondary={
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
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
      <Box sx={{ width: { xs: "100%", md: 360 }, flexShrink: 0 }}>
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
            <Typography variant="body2" color="text.secondary">
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
                              mb: 0.5,
                            }}
                          >
                            <Typography
                              variant="subtitle2"
                              sx={{
                                fontWeight: isSelected ? "bold" : "medium",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                pr: 1,
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
                              sx={{ mt: 0.5, display: "block" }}
                            >
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
              }}
            >
              <Box>
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
                sx={{ textTransform: "capitalize", fontWeight: "bold" }}
              />
            </Box>

            <Card
              elevation={0}
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                bgcolor: "background.default",
              }}
            >
              <CardContent sx={{ p: 4, textAlign: "center" }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: "block", mb: 1, fontWeight: "bold" }}
                >
                  Verification code
                </Typography>
                <Typography
                  variant="h3"
                  sx={{ fontWeight: "bold", letterSpacing: 2 }}
                >
                  {selectedMessage.extracted_code ?? "No code detected"}
                </Typography>
              </CardContent>
            </Card>

            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("new")}
              >
                Mark new
              </Button>
              <Button
                variant="outlined"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("used")}
              >
                Mark used
              </Button>
              <Button
                variant="outlined"
                disabled={isSavingMessage}
                onClick={() => onStatusChange("expired")}
              >
                Mark expired
              </Button>
            </Stack>

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
