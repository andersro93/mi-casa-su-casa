import { ExpandMore } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Collapse,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type { InboxMessage } from "../../types";
import { parseSender } from "../../utils";
import { CopyButton, MessageStatusChip, RelativeTime } from "../ui";
import { CodeDisplay } from "./CodeDisplay";

interface MessageItemProps {
  message: InboxMessage;
  defaultExpanded?: boolean;
  onCopied: (message: InboxMessage) => void;
  onToggleUsed: (message: InboxMessage) => void;
  isSaving?: boolean;
}

/** One message in a service's history: summary row that expands to the code and full email. */
export function MessageItem({
  message,
  defaultExpanded = false,
  onCopied,
  onToggleUsed,
  isSaving = false,
}: MessageItemProps) {
  const [showBody, setShowBody] = useState(false);
  const sender = parseSender(message.from_header);
  const subject = message.subject ?? "Untitled message";

  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      elevation={0}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: "12px !important",
        "&:before": { display: "none" },
        overflow: "hidden",
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMore />}
        sx={{
          px: 2,
          py: 0.5,
          // Let long subjects truncate instead of pushing the row off-screen.
          "& .MuiAccordionSummary-content": { minWidth: 0 },
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1, pr: 1 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", minWidth: 0 }}
          >
            <Typography
              variant="subtitle1"
              noWrap
              sx={{
                fontWeight: message.status === "new" ? 700 : 600,
                minWidth: 0,
              }}
            >
              {subject}
            </Typography>
            <MessageStatusChip status={message.status} sx={{ flexShrink: 0 }} />
          </Stack>
          <Typography variant="body2" color="text.secondary" noWrap>
            {sender.name}
            {" · "}
            <RelativeTime
              value={message.received_at}
              component="span"
              variant="body2"
            />
            {message.extracted_code ? (
              <>
                {" · "}
                <Box
                  component="span"
                  sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
                >
                  {message.extracted_code}
                </Box>
              </>
            ) : null}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
        <Stack spacing={2}>
          {message.extracted_code ? (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1.5,
                bgcolor: "background.default",
              }}
            >
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                >
                  Code
                </Typography>
                <CodeDisplay code={message.extracted_code} size="small" />
              </Box>
              <CopyButton
                value={message.extracted_code}
                label="Copy code"
                variant="button"
                size="small"
                onCopied={() => onCopied(message)}
              />
            </Paper>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No code in this message.
            </Typography>
          )}

          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap" }}
          >
            <Button
              size="small"
              variant="text"
              onClick={() => setShowBody((v) => !v)}
              aria-expanded={showBody}
            >
              {showBody ? "Hide full email" : "Show full email"}
            </Button>
            <Button
              size="small"
              variant="text"
              color="inherit"
              disabled={isSaving}
              onClick={() => onToggleUsed(message)}
            >
              {message.status === "used" ? "Mark as unused" : "Mark as used"}
            </Button>
          </Stack>

          <Collapse in={showBody} unmountOnExit>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mb: 1 }}
              >
                From {sender.address ?? sender.name}
              </Typography>
              <Typography
                component="pre"
                variant="body2"
                sx={{
                  m: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                }}
              >
                {message.text_body}
              </Typography>
            </Paper>
          </Collapse>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
