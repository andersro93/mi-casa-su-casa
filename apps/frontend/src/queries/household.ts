import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { HouseholdSettingsResponse } from "../types";
import { buildHouseholdApiPath, fetchJson } from "../utils";

export const householdKeys = {
  settings: (slug: string) => ["household", slug, "settings"] as const,
};

export function householdSettingsOptions(slug: string) {
  return queryOptions({
    queryKey: householdKeys.settings(slug),
    queryFn: async () => {
      const response = await fetchJson<HouseholdSettingsResponse>(
        buildHouseholdApiPath(slug, "/admin/settings"),
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
      fetchJson<HouseholdSettingsResponse>(
        buildHouseholdApiPath(slug, "/admin/settings"),
        { method: "PATCH", body: JSON.stringify({ displayName }) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: householdKeys.settings(slug) }),
  });
}
