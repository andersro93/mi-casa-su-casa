import { MailOutlined } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import type { InboxMessage, ProviderSummary } from "../../types";
import {
  CopyButton,
  EmptyState,
  ErrorState,
  LoadingState,
  RelativeTime,
} from "../ui";
import { CodeDisplay } from "./CodeDisplay";
import { MessageItem } from "./MessageItem";
import { ServiceAvatar } from "./ServiceAvatar";

interface ServiceDetailProps {
  provider: ProviderSummary;
  messages: InboxMessage[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  onCopied: (message: InboxMessage) => void;
  onToggleUsed: (message: InboxMessage) => void;
  isSaving: boolean;
}

/** A service: its newest code front and centre, then the earlier messages. */
export function ServiceDetail({
  provider,
  messages,
  isLoading,
  error,
  onRetry,
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
  onCopied,
  onToggleUsed,
  isSaving,
}: ServiceDetailProps) {
  const newest = messages[0];
  const earlier = messages.slice(1);

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <ServiceAvatar
          name={provider.display_name}
          newCount={provider.new_count}
          size={44}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" component="h2" noWrap>
            {provider.display_name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {provider.message_count === 1
              ? "1 message"
              : `${provider.message_count} messages`}
            {provider.new_count > 0 ? ` · ${provider.new_count} new` : ""}
          </Typography>
        </Box>
      </Stack>

      {error ? <ErrorState message={error} onRetry={onRetry} /> : null}

      {isLoading && messages.length === 0 ? (
        <LoadingState variant="detail" label="Loading messages" />
      ) : messages.length === 0 && !error ? (
        <EmptyState
          icon={<MailOutlined />}
          title="No messages yet"
          description="The next code sent to this service will appear here within seconds."
        />
      ) : null}

      {newest ? (
        <Card
          sx={{
            bgcolor:
              newest.status === "new" ? "primary.main" : "background.paper",
            color:
              newest.status === "new" ? "primary.contrastText" : "text.primary",
            borderColor: newest.status === "new" ? "primary.main" : "divider",
          }}
        >
          <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
            <Typography
              variant="overline"
              component="div"
              sx={{ opacity: 0.85 }}
            >
              {newest.status === "new"
                ? "Latest code"
                : `Latest code · ${newest.status}`}
            </Typography>
            {newest.extracted_code ? (
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{
                  alignItems: { xs: "flex-start", sm: "center" },
                  justifyContent: "space-between",
                  mt: 0.5,
                }}
              >
                <CodeDisplay code={newest.extracted_code} />
                <CopyButton
                  value={newest.extracted_code}
                  label="Copy code"
                  variant="button"
                  size="large"
                  color={newest.status === "new" ? "inherit" : "primary"}
                  onCopied={() => onCopied(newest)}
                  sx={
                    newest.status === "new"
                      ? {
                          bgcolor: "background.paper",
                          color: "primary.main",
                          "&:hover": { bgcolor: "background.default" },
                          flexShrink: 0,
                        }
                      : { flexShrink: 0 }
                  }
                />
              </Stack>
            ) : (
              <Typography variant="h5" component="p" sx={{ mt: 0.5 }}>
                No code in the latest message
              </Typography>
            )}
            <Typography variant="body2" sx={{ mt: 1.5, opacity: 0.9 }}>
              {newest.subject ?? "Untitled message"}
              {" · "}
              <RelativeTime
                value={newest.received_at}
                prefix="received"
                component="span"
                variant="body2"
                color="inherit"
              />
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {newest ? (
        <Box>
          <Typography
            variant="overline"
            color="text.secondary"
            component="h3"
            sx={{ mb: 1 }}
          >
            {earlier.length > 0 ? "Messages" : "Message"}
          </Typography>
          <Stack spacing={1}>
            <MessageItem
              message={newest}
              onCopied={onCopied}
              onToggleUsed={onToggleUsed}
              isSaving={isSaving}
            />
            {earlier.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                onCopied={onCopied}
                onToggleUsed={onToggleUsed}
                isSaving={isSaving}
              />
            ))}
          </Stack>
          {hasOlder ? (
            <Box sx={{ textAlign: "center", mt: 2 }}>
              <Button
                variant="outlined"
                color="inherit"
                onClick={onLoadOlder}
                disabled={isLoadingOlder}
              >
                {isLoadingOlder ? "Loading…" : "Show older messages"}
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}
