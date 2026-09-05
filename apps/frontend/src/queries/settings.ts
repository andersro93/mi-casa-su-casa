import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client, unwrap } from "../lib/api";
import { password, twoFactor } from "../lib/auth-client";
import type { AccountProfile, AccountSettingsResponse } from "../types";

export const settingsKeys = {
  account: ["settings", "account"] as const,
};

export function accountSettingsOptions() {
  return queryOptions({
    queryKey: settingsKeys.account,
    queryFn: () => unwrap<AccountSettingsResponse>(client.GET("/api/settings")),
  });
}

export function useAccountSettings() {
  return useQuery(accountSettingsOptions());
}

/**
 * The signed-in account's own user id.
 *
 * It deliberately does NOT come from the session: Limen's `/api/auth/me`
 * describes the account as *its* tables see it, and the id this app compares
 * against (`member.id` on the members screen, provider access rows) is the
 * application's. `GET /api/settings` is the one place the server states it.
 */
export function useCurrentUserId(): string | null {
  const { data } = useAccountSettings();
  return data?.profile.id ?? null;
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; image: string }) =>
      unwrap<{ profile: AccountProfile }>(
        client.PATCH("/api/settings/profile", { body: input }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      unwrap<{ ok: boolean }>(
        client.DELETE("/api/settings/sessions/{sessionId}", {
          params: { path: { sessionId } },
        }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap<{ ok: boolean }>(client.DELETE("/api/settings/sessions/others")),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useLeaveHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      unwrap<{ ok: boolean }>(
        client.POST("/api/households/{slug}/leave", {
          params: { path: { slug } },
        }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      password.change(input.currentPassword, input.newPassword),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => password.requestReset(email),
  });
}

/**
 * Step one of two-step enrolment: confirm the password, get the otpauth URI
 * to render as a QR code. Nothing is switched on yet — the account still has
 * two-factor off until `useVerifyTwoStep` succeeds.
 */
export function useEnableTwoStep() {
  return useMutation({
    mutationFn: (passwordValue: string) =>
      twoFactor.initiateSetup(passwordValue),
  });
}

/**
 * Step two: the code from the authenticator app. On success two-step is on,
 * and the backup codes exist — Limen only serves them to an enrolled account,
 * so they are fetched here rather than alongside the QR.
 */
export function useVerifyTwoStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<string[]> => {
      await twoFactor.finalizeSetup(code);
      return await twoFactor.getBackupCodes();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}

/** A fresh set of one-shot codes; the old ones stop working. */
export function useRegenerateBackupCodes() {
  return useMutation({
    mutationFn: () => twoFactor.regenerateBackupCodes(),
  });
}

export function useDisableTwoStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passwordValue: string) => twoFactor.disable(passwordValue),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.account }),
  });
}
