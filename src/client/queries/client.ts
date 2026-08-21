import { QueryClient } from "@tanstack/react-query";

/** App-wide defaults: data is fresh for a few seconds, one retry, no refetch storms. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  });
}
