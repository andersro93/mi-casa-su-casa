import { ArrowBack } from "@mui/icons-material";
import {
  Box,
  Button,
  Paper,
  Stack,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  flattenMessages,
  inboxKeys,
  useProviderMessages,
  useProviderSummaries,
  useUpdateMessageStatus,
} from "../../queries/inbox";
import type { InboxMessage } from "../../types";
import { buildHouseholdPath } from "../../utils";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../ui";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { ServiceDetail } from "./ServiceDetail";
import { ServiceList } from "./ServiceList";

interface InboxPageProps {
  slug: string;
  householdName: string;
  isOwner: boolean;
}

/**
 * The member-facing screen. Phones: a list of services each showing its
 * latest code (copy without opening anything) → tap for that service's
 * messages. Desktop: the same list on the left, the selected service on the
 * right. Data polls while the tab is visible.
 */
export function InboxPage({ slug, householdName, isOwner }: InboxPageProps) {
  const { providerKey } = useParams<{ providerKey?: string }>();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const queryClient = useQueryClient();

  const providersQuery = useProviderSummaries(slug);
  const providers = providersQuery.data ?? [];
  const selectedKey =
    providerKey ?? (isDesktop ? providers[0]?.provider_key : undefined);
  const selected =
    providers.find((p) => p.provider_key === selectedKey) ?? null;

  const messagesQuery = useProviderMessages(slug, selectedKey);
  const messages = flattenMessages(messagesQuery.data?.pages);
  const updateStatus = useUpdateMessageStatus(slug);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: inboxKeys.all(slug) });
  };

  const markUsedAfterCopy = (message: InboxMessage) => {
    if (message.status === "new") {
      updateStatus.mutate({
        messageId: message.id,
        providerKey: message.provider_key,
        status: "used",
      });
    }
  };

  const toggleUsed = (message: InboxMessage) => {
    updateStatus.mutate({
      messageId: message.id,
      providerKey: message.provider_key,
      status: message.status === "used" ? "new" : "used",
    });
  };

  const freshness = (
    <FreshnessIndicator
      updatedAt={providersQuery.dataUpdatedAt || undefined}
      isFetching={providersQuery.isFetching || messagesQuery.isFetching}
      onRefresh={refreshAll}
    />
  );

  const providersError =
    providersQuery.error instanceof Error ? providersQuery.error.message : null;

  const list = providersQuery.isLoading ? (
    <LoadingState
      variant={isDesktop ? "list" : "cards"}
      rows={4}
      label="Loading services"
    />
  ) : providersError && providers.length === 0 ? (
    <ErrorState
      message={providersError}
      onRetry={() => void providersQuery.refetch()}
    />
  ) : (
    <ServiceList
      slug={slug}
      providers={providers}
      selectedKey={selectedKey}
      variant={isDesktop ? "rows" : "cards"}
      isOwner={isOwner}
      onCopied={(provider) => {
        if (provider.latest_message_id && provider.latest_status === "new") {
          updateStatus.mutate({
            messageId: provider.latest_message_id,
            providerKey: provider.provider_key,
            status: "used",
          });
        }
      }}
    />
  );

  const detail = selected ? (
    <ServiceDetail
      provider={selected}
      messages={messages}
      isLoading={messagesQuery.isLoading}
      error={
        messagesQuery.error instanceof Error
          ? messagesQuery.error.message
          : null
      }
      onRetry={() => void messagesQuery.refetch()}
      hasOlder={Boolean(messagesQuery.hasNextPage)}
      isLoadingOlder={messagesQuery.isFetchingNextPage}
      onLoadOlder={() => void messagesQuery.fetchNextPage()}
      onCopied={markUsedAfterCopy}
      onToggleUsed={toggleUsed}
      isSaving={updateStatus.isPending}
    />
  ) : null;

  // Phone: either the list or one service.
  if (!isDesktop) {
    if (providerKey) {
      return (
        <Stack spacing={2}>
          <Box>
            <Button
              component={RouterLink}
              to={buildHouseholdPath(slug, "/inbox")}
              startIcon={<ArrowBack />}
              color="inherit"
              sx={{ ml: -1 }}
            >
              All services
            </Button>
          </Box>
          {detail ??
            (!providersQuery.isLoading ? (
              <EmptyState
                title="Service not found"
                description="It may have been removed, or you no longer have access to it."
              />
            ) : (
              <LoadingState variant="detail" label="Loading service" />
            ))}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            {freshness}
          </Box>
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <PageHeader
          eyebrow={householdName}
          title="Latest codes"
          action={freshness}
        />
        {list}
      </Stack>
    );
  }

  // Desktop: list on the left, selected service on the right.
  return (
    <Box>
      <PageHeader
        eyebrow={householdName}
        title="Latest codes"
        action={freshness}
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { md: "minmax(280px, 360px) minmax(0, 1fr)" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Paper variant="outlined" sx={{ p: 1, position: "sticky", top: 88 }}>
          {list}
        </Paper>
        <Box sx={{ minWidth: 0 }}>
          {detail ??
            (providers.length > 0 || providersQuery.isLoading ? (
              <LoadingState variant="detail" label="Loading service" />
            ) : null)}
        </Box>
      </Box>
    </Box>
  );
}
