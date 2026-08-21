import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { QuarantineMessage, QuarantineMessagesResponse } from "../types";
import { buildHouseholdApiPath, fetchJson } from "../utils";
import { adminKeys } from "./admin";
import { inboxKeys } from "./inbox";

export const reviewKeys = {
  all: (slug: string) => ["review", slug] as const,
};

export const REVIEW_PAGE_SIZE = 50;

export function reviewQueueOptions(slug: string) {
  return infiniteQueryOptions({
    queryKey: reviewKeys.all(slug),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(REVIEW_PAGE_SIZE) });
      if (pageParam) params.set("before", pageParam);
      return fetchJson<QuarantineMessagesResponse>(
        buildHouseholdApiPath(slug, `/inbox/quarantine?${params}`),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.page.nextBefore,
  });
}

export function useReviewQueue(slug: string | null | undefined) {
  return useInfiniteQuery({
    ...reviewQueueOptions(slug ?? ""),
    enabled: Boolean(slug),
  });
}

export function flattenReviewQueue(
  pages: QuarantineMessagesResponse[] | undefined,
): QuarantineMessage[] {
  return pages?.flatMap((page) => page.messages) ?? [];
}

/** Hide a message, or file it under a service (optionally teaching a sender rule). */
export function useReviewMessage(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      messageId: string;
      action: "dismiss" | "release";
      providerKey?: string;
      /** When filing: also create a domain sender rule so future mail is matched. */
      learnSender?: { providerId: string; domain: string } | null;
    }) => {
      if (input.learnSender) {
        await fetchJson<{ rule: unknown }>(
          buildHouseholdApiPath(slug, "/admin/provider-rules"),
          {
            method: "POST",
            body: JSON.stringify({
              providerId: input.learnSender.providerId,
              matchType: "domain",
              matchValue: input.learnSender.domain,
            }),
          },
        );
      }
      return fetchJson<{ ok?: boolean }>(
        buildHouseholdApiPath(
          slug,
          `/inbox/quarantine/${input.messageId}/review`,
        ),
        {
          method: "POST",
          body: JSON.stringify(
            input.action === "release"
              ? { action: "release", providerKey: input.providerKey }
              : { action: "dismiss" },
          ),
        },
      );
    },
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.all(slug) }),
        queryClient.invalidateQueries({ queryKey: inboxKeys.all(slug) }),
        input.learnSender
          ? queryClient.invalidateQueries({
              queryKey: adminKeys.services(slug),
            })
          : Promise.resolve(),
      ]);
    },
  });
}
