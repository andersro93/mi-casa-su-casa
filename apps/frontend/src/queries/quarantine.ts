import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { client, unwrap } from "../lib/api";
import type {
  QuarantineMessage,
  QuarantineMessagesResponse,
  QuarantineReviewResult,
} from "../types";
import { adminKeys } from "./admin";
import { inboxKeys } from "./inbox";

export const reviewKeys = {
  all: (slug: string) => ["review", slug] as const,
};

export const REVIEW_PAGE_SIZE = 50;

export function reviewQueueOptions(slug: string) {
  return infiniteQueryOptions({
    queryKey: reviewKeys.all(slug),
    queryFn: ({ pageParam }) =>
      unwrap<QuarantineMessagesResponse>(
        client.GET("/api/inbox/{slug}/quarantine", {
          params: {
            path: { slug },
            query: { limit: REVIEW_PAGE_SIZE, before: pageParam ?? undefined },
          },
        }),
      ),
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
        await unwrap(
          client.POST("/api/admin/{slug}/provider-rules", {
            params: { path: { slug } },
            body: {
              providerId: input.learnSender.providerId,
              matchType: "domain",
              matchValue: input.learnSender.domain,
            },
          }),
        );
      }
      return unwrap<QuarantineReviewResult>(
        client.POST("/api/inbox/{slug}/quarantine/{messageId}/review", {
          params: { path: { slug, messageId: input.messageId } },
          body:
            input.action === "release"
              ? { action: "release", providerKey: input.providerKey }
              : { action: "dismiss" },
        }),
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
