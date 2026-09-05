import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client, unwrap } from "../lib/api";
import type { HouseholdSettingsResponse } from "../types";

export const householdKeys = {
  settings: (slug: string) => ["household", slug, "settings"] as const,
};

export function householdSettingsOptions(slug: string) {
  return queryOptions({
    queryKey: householdKeys.settings(slug),
    queryFn: async () => {
      const response = await unwrap<HouseholdSettingsResponse>(
        client.GET("/api/admin/{slug}/settings", {
          params: { path: { slug } },
        }),
      );
      return response.household;
    },
  });
}

export function useHouseholdSettings(slug: string | null | undefined) {
  return useQuery({
    ...householdSettingsOptions(slug ?? ""),
    enabled: Boolean(slug),
  });
}

export function useRenameHousehold(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) =>
      unwrap<HouseholdSettingsResponse>(
        client.PATCH("/api/admin/{slug}/settings", {
          params: { path: { slug } },
          body: { displayName },
        }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: householdKeys.settings(slug) }),
  });
}
