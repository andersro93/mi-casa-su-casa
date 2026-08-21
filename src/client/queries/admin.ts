import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ProviderConfiguration,
  ProviderConfigurationResponse,
  SenderRule,
} from "../types";
import { buildHouseholdApiPath, fetchJson } from "../utils";
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
      fetchJson<ProviderConfigurationResponse>(
        buildHouseholdApiPath(slug, "/admin/providers"),
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
      fetchJson<{ provider: ProviderConfiguration }>(
        buildHouseholdApiPath(slug, "/admin/providers"),
        { method: "POST", body: JSON.stringify(input) },
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
      fetchJson<{ provider: ProviderConfiguration }>(
        buildHouseholdApiPath(slug, `/admin/providers/${input.id}`),
        {
          method: "PATCH",
          body: JSON.stringify({
            providerKey: input.providerKey,
            displayName: input.displayName,
          }),
        },
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteService(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: boolean }>(
        buildHouseholdApiPath(slug, `/admin/providers/${id}`),
        { method: "DELETE" },
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
      fetchJson<{ rule: SenderRule }>(
        buildHouseholdApiPath(slug, "/admin/provider-rules"),
        { method: "POST", body: JSON.stringify(input) },
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
      fetchJson<{ rule: SenderRule }>(
        buildHouseholdApiPath(slug, `/admin/provider-rules/${input.id}`),
        {
          method: "PATCH",
          body: JSON.stringify({
            providerId: input.providerId,
            matchType: input.matchType,
            matchValue: input.matchValue,
          }),
        },
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteSender(slug: string) {
  const invalidate = useInvalidateServices(slug);
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: boolean }>(
        buildHouseholdApiPath(slug, `/admin/provider-rules/${id}`),
        { method: "DELETE" },
      ),
    onSuccess: invalidate,
  });
}
