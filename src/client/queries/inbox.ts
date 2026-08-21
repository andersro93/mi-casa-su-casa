import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InboxMessage, ProviderSummary } from "../types";
import { buildHouseholdApiPath, fetchJson } from "../utils";

/**
 * Inbox data. Codes arrive while the user is waiting, so summaries and the
 * open conversation poll while the tab is visible (TanStack pauses interval
 * refetches in background tabs) and refetch on focus/reconnect.
 */
export const INBOX_REFETCH_INTERVAL_MS = 10_000;
export const INBOX_PAGE_SIZE = 50;

export const inboxKeys = {
  all: (slug: string) => ["inbox", slug] as const,
  providers: (slug: string) => ["inbox", slug, "providers"] as const,
  messages: (slug: string, providerKey: string) =>
    ["inbox", slug, "messages", providerKey] as const,
};

export type ProviderMessagesPage = {
  provider: { providerKey: string; displayName: string };
  messages: InboxMessage[];
  page: { limit: number; nextBefore: string | null };
};

export function providerSummariesOptions(slug: string) {
  return queryOptions({
    queryKey: inboxKeys.providers(slug),
    queryFn: async () => {
      const response = await fetchJson<{ providers: ProviderSummary[] }>(
        buildHouseholdApiPath(slug, "/inbox/providers"),
      );
      return response.providers;
    },
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
  });
}

export function providerMessagesOptions(slug: string, providerKey: string) {
  return infiniteQueryOptions({
    queryKey: inboxKeys.messages(slug, providerKey),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(INBOX_PAGE_SIZE) });
      if (pageParam) params.set("before", pageParam);
      return fetchJson<ProviderMessagesPage>(
        buildHouseholdApiPath(
          slug,
          `/inbox/providers/${encodeURIComponent(providerKey)}?${params}`,
        ),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.page.nextBefore,
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
  });
}

export function useProviderSummaries(slug: string | null | undefined) {
  return useQuery({
    ...providerSummariesOptions(slug ?? ""),
    enabled: Boolean(slug),
  });
}

export function useProviderMessages(
  slug: string | null | undefined,
  providerKey: string | null | undefined,
) {
  return useInfiniteQuery({
    ...providerMessagesOptions(slug ?? "", providerKey ?? ""),
    enabled: Boolean(slug && providerKey),
  });
}

/** Flatten infinite pages into one list (newest first, as the API returns). */
export function flattenMessages(
  pages: ProviderMessagesPage[] | undefined,
): InboxMessage[] {
  return pages?.flatMap((page) => page.messages) ?? [];
}

export function useUpdateMessageStatus(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      messageId: string;
      providerKey: string;
      status: InboxMessage["status"];
    }) => {
      const response = await fetchJson<{ message: InboxMessage }>(
        buildHouseholdApiPath(
          slug,
          `/inbox/messages/${input.messageId}/status`,
        ),
        { method: "PATCH", body: JSON.stringify({ status: input.status }) },
      );
      return response.message;
    },
    onSuccess: (message, input) => {
      // Patch the open conversation in place so the UI flips instantly, then
      // let the summaries (new counts, latest status) refresh.
      queryClient.setQueryData<{
        pages: ProviderMessagesPage[];
        pageParams: unknown[];
      }>(inboxKeys.messages(slug, input.providerKey), (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                messages: page.messages.map((m) =>
                  m.id === message.id ? message : m,
                ),
              })),
            }
          : current,
      );
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.providers(slug),
      });
    },
  });
}
