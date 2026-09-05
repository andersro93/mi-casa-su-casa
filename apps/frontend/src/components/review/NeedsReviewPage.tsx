import { ExpandMore, VerifiedUserOutlined } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { useId, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useServices } from "../../queries/admin";
import { useProviderSummaries } from "../../queries/inbox";
import {
  flattenReviewQueue,
  useReviewMessage,
  useReviewQueue,
} from "../../queries/quarantine";
import type { ProviderSummary, QuarantineMessage } from "../../types";
import { buildHouseholdPath, parseSender } from "../../utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { CodeDisplay } from "../inbox/CodeDisplay";
import {
  CopyButton,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  RelativeTime,
  StatusChip,
} from "../ui";
import {
  describeReviewReason,
  senderDomain,
  suggestService,
} from "./reviewReasons";

interface NeedsReviewPageProps {
  slug: string;
  householdName: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Owner screen: emails that couldn't be filed automatically, reviewed in place. */
export function NeedsReviewPage({ slug, householdName }: NeedsReviewPageProps) {
  const queue = useReviewQueue(slug);
  const messages = flattenReviewQueue(queue.data?.pages);
  const providersQuery = useProviderSummaries(slug);
  const providers = providersQuery.data ?? [];
  const servicesQuery = useServices(slug);
  const review = useReviewMessage(slug);

  const [filing, setFiling] = useState<QuarantineMessage | null>(null);
  const [hiding, setHiding] = useState<QuarantineMessage | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const close = () => {
    setFiling(null);
    setHiding(null);
    setDialogError(null);
  };

  const run = async (
    action: () => Promise<unknown>,
    success: string,
    fallback: string,
  ) => {
    setDialogError(null);
    try {
      await action();
      setToast(success);
      close();
    } catch (error) {
      setDialogError(errorMessage(error, fallback));
    }
  };

  let body: React.ReactNode;
  if (queue.isLoading) {
    body = (
      <LoadingState variant="cards" rows={3} label="Loading emails to review" />
    );
  } else if (queue.error) {
    body = (
      <ErrorState
        message={errorMessage(queue.error, "Couldn't load the review queue.")}
        onRetry={() => void queue.refetch()}
      />
    );
  } else if (messages.length === 0) {
    body = (
      <EmptyState
        icon={<VerifiedUserOutlined />}
        title="All clear"
        description="Every email has been filed. When one arrives that we can't match to a service, or that fails the sender checks, it shows up here for you to decide."
      />
    );
  } else {
    body = (
      <Stack
        spacing={1.5}
        component="ul"
        sx={{ listStyle: "none", p: 0, m: 0 }}
        aria-label="Emails needing review"
      >
        {messages.map((message) => {
          const reason = describeReviewReason(message.quarantine_reason);
          const sender = parseSender(message.from_header);
          return (
            <Accordion
              key={message.id}
              component="li"
              disableGutters
              elevation={0}
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: "16px !important",
                "&:before": { display: "none" },
                overflow: "hidden",
                bgcolor: "background.paper",
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMore />}
                sx={{
                  px: 2,
                  py: 0.75,
                  "& .MuiAccordionSummary-content": { minWidth: 0 },
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1, pr: 1 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", minWidth: 0, flexWrap: "wrap" }}
                    useFlexGap
                  >
                    <Typography variant="subtitle1" noWrap sx={{ minWidth: 0 }}>
                      {message.subject ?? "Untitled message"}
                    </Typography>
                    <StatusChip tone={reason.tone} label={reason.label} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {sender.name}
                    {sender.address ? ` <${sender.address}>` : ""}
                    {" · "}
                    <RelativeTime
                      value={message.received_at}
                      component="span"
                      variant="body2"
                    />
                    {message.extracted_code
                      ? ` · code ${message.extracted_code}`
                      : ""}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
                <Stack spacing={2}>
                  <Alert
                    severity={reason.tone}
                    icon={false}
                    sx={{ "& .MuiAlert-message": { width: "100%" } }}
                  >
                    <Typography variant="subtitle2">{reason.label}</Typography>
                    <Typography variant="body2">
                      {reason.explanation}
                    </Typography>
                  </Alert>
                  <Typography variant="body2" color="text.secondary">
                    Sent from <strong>{message.envelope_from}</strong>
                    {sender.address && sender.address !== message.envelope_from
                      ? ` (shown as ${sender.address})`
                      : ""}
                    .
                  </Typography>
                  {message.extracted_code ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 1.5,
                        flexWrap: "wrap",
                        bgcolor: "background.default",
                      }}
                    >
                      <Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="div"
                        >
                          Code in this email
                        </Typography>
                        <CodeDisplay
                          code={message.extracted_code}
                          size="small"
                        />
                      </Box>
                      <CopyButton
                        value={message.extracted_code}
                        label="Copy code"
                        variant="button"
                        size="small"
                      />
                    </Paper>
                  ) : null}
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography
                      component="pre"
                      variant="body2"
                      sx={{
                        m: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily: "inherit",
                        maxHeight: 320,
                        overflow: "auto",
                      }}
                    >
                      {message.text_body}
                    </Typography>
                  </Paper>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <Button
                      variant="contained"
                      onClick={() => setFiling(message)}
                      disabled={review.isPending}
                    >
                      File under a service…
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      onClick={() => setHiding(message)}
                      disabled={review.isPending}
                    >
                      Hide this email
                    </Button>
                  </Stack>
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
        {queue.hasNextPage ? (
          <Box component="li" sx={{ textAlign: "center" }}>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => void queue.fetchNextPage()}
              disabled={queue.isFetchingNextPage}
            >
              {queue.isFetchingNextPage ? "Loading…" : "Show older"}
            </Button>
          </Box>
        ) : null}
      </Stack>
    );
  }

  return (
    <Box sx={{ maxWidth: 860 }}>
      <PageHeader
        eyebrow={householdName}
        title="Needs review"
        description="Emails we couldn't match to a service, or that failed the checks proving who sent them. Members never see these until you decide what to do."
      />
      {body}

      <FileDialog
        message={filing}
        providers={providers}
        serviceIds={
          new Map(
            (servicesQuery.data?.providers ?? []).map((p) => [
              p.provider_key,
              p.id,
            ]),
          )
        }
        isSaving={review.isPending}
        error={dialogError}
        onClose={close}
        onFile={(providerKey, learnDomain) =>
          filing
            ? run(
                () => {
                  const providerId = (servicesQuery.data?.providers ?? []).find(
                    (p) => p.provider_key === providerKey,
                  )?.id;
                  return review.mutateAsync({
                    messageId: filing.id,
                    action: "release",
                    providerKey,
                    learnSender:
                      learnDomain && providerId
                        ? { providerId, domain: learnDomain }
                        : null,
                  });
                },
                `Filed under ${providers.find((p) => p.provider_key === providerKey)?.display_name ?? "the service"}.`,
                "Couldn't file the email.",
              )
            : undefined
        }
        slug={slug}
      />

      <ConfirmDialog
        open={Boolean(hiding)}
        title="Hide this email?"
        description="It stays out of everyone's inbox and is deleted with the rest of the mail after 30 days. Nothing is sent to anyone."
        confirmLabel="Hide email"
        loadingLabel="Hiding…"
        isLoading={review.isPending}
        error={dialogError}
        onClose={close}
        onConfirm={() =>
          hiding
            ? run(
                () =>
                  review.mutateAsync({
                    messageId: hiding.id,
                    action: "dismiss",
                  }),
                "Email hidden.",
                "Couldn't hide the email.",
              )
            : undefined
        }
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}

interface FileDialogProps {
  slug: string;
  message: QuarantineMessage | null;
  providers: ProviderSummary[];
  serviceIds: Map<string, string>;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onFile: (
    providerKey: string,
    learnDomain: string | null,
  ) => void | Promise<void>;
}

function FileDialog({
  slug,
  message,
  providers,
  serviceIds,
  isSaving,
  error,
  onClose,
  onFile,
}: FileDialogProps) {
  const titleId = useId();
  const labelId = useId();
  const suggested = message ? suggestService(message, providers) : null;
  const [providerKey, setProviderKey] = useState<string>("");
  const [learn, setLearn] = useState(true);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  // Reset the selection when a different message is opened.
  if (message && message.id !== lastMessageId) {
    setLastMessageId(message.id);
    setProviderKey(suggested?.provider_key ?? providers[0]?.provider_key ?? "");
    setLearn(true);
  }
  const domain = message ? senderDomain(message) : "";
  const reason = message
    ? describeReviewReason(message.quarantine_reason)
    : null;
  const canLearn = Boolean(domain) && reason?.tone !== "error";

  return (
    <Dialog
      open={Boolean(message)}
      onClose={isSaving ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId}>File under a service</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {providers.length === 0 ? (
            <Alert severity="info">
              You haven't added any services yet.{" "}
              <RouterLink to={buildHouseholdPath(slug, "/providers")}>
                Add one under Services
              </RouterLink>{" "}
              first.
            </Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                Members with access to that service will see this email in their
                inbox.
              </Typography>
              <FormControl fullWidth>
                <InputLabel id={labelId}>Service</InputLabel>
                <Select
                  labelId={labelId}
                  label="Service"
                  value={providerKey}
                  onChange={(e) => setProviderKey(String(e.target.value))}
                >
                  {providers.map((provider) => (
                    <MenuItem
                      key={provider.provider_key}
                      value={provider.provider_key}
                    >
                      {provider.display_name}
                      {suggested?.provider_key === provider.provider_key
                        ? " (suggested)"
                        : ""}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Collapse in={canLearn}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={learn}
                      onChange={(e) => setLearn(e.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="body2">
                      Also treat future emails from <strong>{domain}</strong> as
                      this service
                    </Typography>
                  }
                />
              </Collapse>
              {reason?.tone === "error" ? (
                <Alert severity="warning">
                  This email failed the sender checks, so we won't remember the
                  sender automatically. Only file it if you're confident it's
                  genuine.
                </Alert>
              ) : null}
            </>
          )}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button
          onClick={onClose}
          disabled={isSaving}
          variant="outlined"
          color="inherit"
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={isSaving || !providerKey || providers.length === 0}
          onClick={() =>
            void onFile(
              providerKey,
              canLearn && learn && serviceIds.has(providerKey) ? domain : null,
            )
          }
        >
          {isSaving ? "Filing…" : "File email"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
