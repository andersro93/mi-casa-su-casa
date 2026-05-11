import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import type { ProviderSummary, QuarantineMessage } from "../types";
import { formatTimestamp } from "../utils";

interface QuarantineViewProps {
  quarantineMessages: QuarantineMessage[];
  selectedQuarantineId: string | null;
  onSelectMessage: (id: string) => void;
  isLoadingQuarantine: boolean;
  providers: ProviderSummary[];
  releaseProviderKey: string;
  onReleaseProviderKeyChange: (key: string) => void;
  isReviewingQuarantine: boolean;
  onQuarantineReview: (action: "dismiss" | "release") => void;
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
  const selectedQuarantineMessage = quarantineMessages.find(
    (m) => m.id === selectedQuarantineId,
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        gap: 3,
        height: "100%",
      }}
    >
      <Box sx={{ width: { xs: "100%", md: 360 }, flexShrink: 0 }}>
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
                              {message.envelope_from}
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
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: "bold" }}
                  gutterBottom
                >
                  Quarantine is empty
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
              }}
            >
              <Box>
                <Typography variant="h5" sx={{ fontWeight: "bold", mb: 0.5 }}>
                  {selectedQuarantineMessage.subject ?? "Untitled message"}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {selectedQuarantineMessage.envelope_from}
                </Typography>
              </Box>
              <Chip
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
                <Typography
                  variant="h3"
                  sx={{ fontWeight: "bold", letterSpacing: 2 }}
                >
                  {selectedQuarantineMessage.extracted_code ??
                    "No code detected"}
                </Typography>
              </CardContent>
            </Card>

            <Alert severity="warning" sx={{ borderRadius: 2 }}>
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
              <FormControl sx={{ minWidth: 200, flexGrow: 1 }}>
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

              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={isReviewingQuarantine || !releaseProviderKey}
                  onClick={() => onQuarantineReview("release")}
                  sx={{ px: 4, py: 1.5 }}
                >
                  Release to inbox
                </Button>
                <Button
                  variant="outlined"
                  disabled={isReviewingQuarantine}
                  onClick={() => onQuarantineReview("dismiss")}
                  sx={{ px: 4, py: 1.5 }}
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
    </Box>
  );
}
