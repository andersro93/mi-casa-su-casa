import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client, unwrap } from "../lib/api";
import type {
  ProviderConfiguration,
  ProviderConfigurationResponse,
  SenderRule,
} from "../types";
import { inboxKeys } from "./inbox";

/** Owner-side configuration: services (providers) and their senders (rules). */
export const adminKeys = {
  all: (slug: string) => ["admin", slug] as const,
  services: (slug: string) => ["admin", slug, "services"] as const,
};

export function servicesOptions(slug: string) {
  return queryOptions({
    queryKey: adminKeys.services(slug),
    queryFn: () =>
      unwrap<ProviderConfigurationResponse>(
        client.GET("/api/admin/{slug}/providers", {
          params: { path: { slug } },
        }),
      ),
  });
}

export function useServices(slug: string | null | undefined) {
  return useQuery({ ...servicesOptions(slug ?? ""), enabled: Boolean(slug) });
}

function useInvalidateServices(slug: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.services(slug) }),
      // Service names/keys show up in the inbox and in member access lists.
      queryClient.invalidateQueries({ queryKey: inboxKeys.all(slug) }),
    ]);
  };
}

export function useCreateService(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (input: { providerKey: string; displayName: string }) =>
      unwrap<{ provider: ProviderConfiguration }>(
        client.POST("/api/admin/{slug}/providers", {
          params: { path: { slug } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateService(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (input: {
      id: string;
      providerKey: string;
      displayName: string;
    }) =>
      unwrap<{ provider: ProviderConfiguration }>(
        client.PATCH("/api/admin/{slug}/providers/{providerId}", {
          params: { path: { slug, providerId: input.id } },
          body: {
            providerKey: input.providerKey,
            displayName: input.displayName,
          },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteService(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<{ ok: boolean }>(
        client.DELETE("/api/admin/{slug}/providers/{providerId}", {
          params: { path: { slug, providerId: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useCreateSender(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (input: {
      providerId: string;
      matchType: SenderRule["match_type"];
      matchValue: string;
    }) =>
      unwrap<{ rule: SenderRule }>(
        client.POST("/api/admin/{slug}/provider-rules", {
          params: { path: { slug } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateSender(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (input: {
      id: string;
      providerId: string;
      matchType: SenderRule["match_type"];
      matchValue: string;
    }) =>
      unwrap<{ rule: SenderRule }>(
        client.PATCH("/api/admin/{slug}/provider-rules/{ruleId}", {
          params: { path: { slug, ruleId: input.id } },
          body: {
            providerId: input.providerId,
            matchType: input.matchType,
            matchValue: input.matchValue,
          },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteSender(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<{ ok: boolean }>(
        client.DELETE("/api/admin/{slug}/provider-rules/{ruleId}", {
          params: { path: { slug, ruleId: id } },
        }),
      ),
    onSuccess: invalidate,
  });
}
