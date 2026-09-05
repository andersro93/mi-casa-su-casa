import { authClient } from "@server/auth/client";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AccountProfile, AccountSettingsResponse } from "../types";
import { fetchJson } from "../utils";

export const settingsKeys = {
  account: ["settings", "account"] as const,
  passkeys: ["settings", "passkeys"] as const,
};

export type PasskeyRecord = {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
  deviceType?: string | null;
  backedUp?: boolean | null;
};

export function accountSettingsOptions() {
  return queryOptions({
    queryKey: settingsKeys.account,
    queryFn: () => fetchJson<AccountSettingsResponse>("/api/settings"),
  });
}

export function useAccountSettings() {
  return useQuery(accountSettingsOptions());
}

export function passkeysOptions() {
  return queryOptions({
    queryKey: settingsKeys.passkeys,
    queryFn: async (): Promise<PasskeyRecord[]> => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error) {
        throw new Error(result.error.message ?? "Couldn't load passkeys");
      }
      return (result.data ?? []) as PasskeyRecord[];
    },
  });
}

export function usePasskeys() {
  return useQuery(passkeysOptions());
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; image: string }) =>
      fetchJson<{ profile: AccountProfile }>("/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      fetchJson<{ ok: boolean }>(`/api/settings/sessions/${sessionId}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{ ok: boolean }>("/api/settings/sessions/others", {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useLeaveHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      fetchJson<{ ok: boolean }>(`/api/households/${slug}/leave`, {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

function authResult<T>(
  result: { data: T; error: { message?: string } | null },
  fallback: string,
): T {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: {
      currentPassword: string;
      newPassword: string;
    }) =>
      authResult(
        await authClient.changePassword({
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: false,
        }),
        "Couldn't change the password",
      ),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) =>
      authResult(
        await authClient.requestPasswordReset({
          email,
          redirectTo: "/reset-password",
        }),
        "Couldn't send the reset email",
      ),
  });
}

export function useAddPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const result = await authClient.passkey.addPasskey({ name });
      if (result?.error) {
        throw new Error(result.error.message || "Couldn't add the passkey");
      }
      return result?.data ?? null;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.passkeys }),
  });
}

export function useDeletePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      authResult(
        await authClient.passkey.deletePasskey({ id }),
        "Couldn't remove the passkey",
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.passkeys }),
  });
}

export function useEnableTwoStep() {
  return useMutation({
    mutationFn: async (password: string) => {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error || !result.data || !("totpURI" in result.data)) {
        throw new Error(
          result.error?.message || "Couldn't start two-step verification",
        );
      }
      return result.data as { totpURI: string; backupCodes: string[] };
    },
  });
}

export function useVerifyTwoStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      authResult(
        await authClient.twoFactor.verifyTotp({ code }),
        "That code wasn't accepted. Try the next one.",
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useDisableTwoStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) =>
      authResult(
        await authClient.twoFactor.disable({ password }),
        "Couldn't turn off two-step verification",
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}
