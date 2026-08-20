import {
  CheckCircleOutlined,
  ContentCopyOutlined,
  DeleteOutlined,
  MoveToInboxOutlined,
  ShieldOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import type { ProviderSummary, QuarantineMessage } from "../types";
import { formatTimestamp } from "../utils";
import { ConfirmDialog } from "./ConfirmDialog";

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

interface QuarantineViewProps {
  quarantineMessages: QuarantineMessage[];
  selectedQuarantineId: string | null;
  onSelectMessage: (id: string) => void;
  isLoadingQuarantine: boolean;
  providers: ProviderSummary[];
  releaseProviderKey: string;
  onReleaseProviderKeyChange: (key: string) => void;
  isReviewingQuarantine: boolean;
  onQuarantineReview: (action: "dismiss" | "release") => Promise<boolean>;
}

export function QuarantineView({
  quarantineMessages,
  selectedQuarantineId,
  onSelectMessage,
  isLoadingQuarantine,
  providers,
  releaseProviderKey,
  onReleaseProviderKeyChange,
  isReviewingQuarantine,
  onQuarantineReview,
}: QuarantineViewProps) {
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<
    "dismiss" | "release" | null
  >(null);

  const selectedQuarantineMessage = quarantineMessages.find(
    (m) => m.id === selectedQuarantineId,
  );

  const handleCopyCode = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeId(id);
      setTimeout(() => setCopiedCodeId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleReviewConfirm = async () => {
    if (!reviewAction) {
      return;
    }

    const didReview = await onQuarantineReview(reviewAction);

    if (didReview) {
      setReviewAction(null);
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
      <Box sx={{ width: { xs: "100%", lg: 360 }, flexShrink: 0, minWidth: 0 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ fontWeight: "bold" }}
        >
          Owner tools
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
            Quarantine review
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {quarantineMessages.length} pending
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <List disablePadding>
            {quarantineMessages.map((message, index) => {
              const isSelected = message.id === selectedQuarantineId;

              return (
                <React.Fragment key={message.id}>
                  {index > 0 && <Divider />}
                  <ListItem disablePadding>
                    <ListItemButton
                      selected={isSelected}
                      onClick={() => onSelectMessage(message.id)}
                      sx={{ py: 2, gap: 2 }}
                    >
                      <Avatar {...stringAvatar(message.envelope_from)} />
                      <ListItemText
                        disableTypography
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
                              label="review"
                              size="small"
                              color="warning"
                              variant="outlined"
                              sx={{ height: 20 }}
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
                              {message.from_header ?? message.envelope_from}
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

            {!quarantineMessages.length && !isLoadingQuarantine && (
              <Box sx={{ p: 4, textAlign: "center" }}>
                <ShieldOutlined
                  sx={{ fontSize: 48, color: "text.disabled", mb: 2 }}
                />
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: "bold" }}
                  gutterBottom
                >
                  All clear
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Messages that need manual classification will appear here for
                  owner review.
                </Typography>
              </Box>
            )}
          </List>
        </Paper>
      </Box>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ fontWeight: "bold" }}
        >
          Quarantine detail
        </Typography>
        <Typography
          variant="h5"
          component="h2"
          sx={{ fontWeight: "bold", mb: 2, visibility: "hidden" }}
        >
          Detail
        </Typography>

        {selectedQuarantineMessage ? (
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
                  {selectedQuarantineMessage.subject ?? "Untitled message"}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {selectedQuarantineMessage.from_header ??
                    selectedQuarantineMessage.envelope_from}
                </Typography>
                {selectedQuarantineMessage.from_header &&
                selectedQuarantineMessage.from_header !==
                  selectedQuarantineMessage.envelope_from ? (
                  <Typography variant="caption" color="text.disabled">
                    Envelope sender: {selectedQuarantineMessage.envelope_from}
                  </Typography>
                ) : null}
              </Box>
              <Chip
                icon={<WarningAmberOutlined />}
                label="Needs review"
                color="warning"
                sx={{ fontWeight: "bold" }}
              />
            </Box>

            <Card
              elevation={0}
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                bgcolor: "background.default",
                position: "relative",
              }}
            >
              <CardContent sx={{ p: 4, textAlign: "center" }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: "block", mb: 1, fontWeight: "bold" }}
                >
                  Detected code
                </Typography>
                <Box
                  sx={{
                    display: "inline-flex",
                    flexDirection: { xs: "column", sm: "row" },
                    alignItems: "center",
                    gap: 2,
                    justifyContent: "center",
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
                    {selectedQuarantineMessage.extracted_code ??
                      "No code detected"}
                  </Typography>
                  {selectedQuarantineMessage.extracted_code && (
                    <Tooltip
                      title={
                        copiedCodeId === selectedQuarantineMessage.id
                          ? "Copied!"
                          : "Copy code"
                      }
                      placement="top"
                    >
                      <IconButton
                        onClick={() => {
                          if (selectedQuarantineMessage.extracted_code) {
                            handleCopyCode(
                              selectedQuarantineMessage.extracted_code,
                              selectedQuarantineMessage.id,
                            );
                          }
                        }}
                        color={
                          copiedCodeId === selectedQuarantineMessage.id
                            ? "success"
                            : "default"
                        }
                        sx={{ ml: 1 }}
                      >
                        {copiedCodeId === selectedQuarantineMessage.id ? (
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

            <Alert
              severity="warning"
              icon={<WarningAmberOutlined fontSize="inherit" />}
              sx={{ borderRadius: 2, alignItems: "center" }}
            >
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: "bold", mb: 0.5 }}
              >
                Why it was quarantined
              </Typography>
              <Typography variant="body2">
                {selectedQuarantineMessage.quarantine_reason}
              </Typography>
            </Alert>

            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                gap: 2,
                alignItems: { xs: "stretch", sm: "flex-end" },
              }}
            >
              <FormControl sx={{ minWidth: { xs: 0, sm: 200 }, flexGrow: 1 }}>
                <InputLabel id="release-provider-label">
                  Release to provider
                </InputLabel>
                <Select
                  labelId="release-provider-label"
                  value={releaseProviderKey}
                  label="Release to provider"
                  onChange={(e) => onReleaseProviderKeyChange(e.target.value)}
                >
                  {providers.map((provider) => (
                    <MenuItem
                      key={provider.provider_key}
                      value={provider.provider_key}
                    >
                      {provider.display_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<MoveToInboxOutlined />}
                  disabled={isReviewingQuarantine || !releaseProviderKey}
                  onClick={() => setReviewAction("release")}
                  sx={{ px: 4, py: 1.5, width: { xs: "100%", sm: "auto" } }}
                >
                  Release to inbox
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DeleteOutlined />}
                  disabled={isReviewingQuarantine}
                  onClick={() => setReviewAction("dismiss")}
                  sx={{ px: 4, py: 1.5, width: { xs: "100%", sm: "auto" } }}
                >
                  Dismiss
                </Button>
              </Stack>
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
                {selectedQuarantineMessage.text_body}
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
            <WarningAmberOutlined
              sx={{ fontSize: 48, color: "text.disabled", mb: 2 }}
            />
            <Typography variant="h6" sx={{ fontWeight: "bold", mb: 1 }}>
              Select a quarantined message
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Review the classification reason, then release it to the right
              provider or dismiss it.
            </Typography>
          </Paper>
        )}
      </Box>

      <ConfirmDialog
        open={reviewAction !== null}
        title={
          reviewAction === "release"
            ? "Release message to inbox?"
            : "Dismiss quarantined message?"
        }
        description={
          selectedQuarantineMessage ? (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                <strong>
                  {selectedQuarantineMessage.subject ?? "Untitled message"}
                </strong>{" "}
                from {selectedQuarantineMessage.envelope_from}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {reviewAction === "release"
                  ? `This will move the message into ${providers.find((provider) => provider.provider_key === releaseProviderKey)?.display_name || "the selected provider"}.`
                  : "This will remove the message from quarantine review."}
              </Typography>
            </Stack>
          ) : (
            ""
          )
        }
        confirmLabel={
          reviewAction === "release" ? "Release to inbox" : "Dismiss message"
        }
        confirmColor={reviewAction === "release" ? "primary" : "error"}
        isLoading={isReviewingQuarantine}
        confirmDisabled={reviewAction === "release" && !releaseProviderKey}
        onClose={() => setReviewAction(null)}
        onConfirm={handleReviewConfirm}
      />
    </Box>
  );
}
