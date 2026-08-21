import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  InvitationDeliveryResponse,
  InvitationSummary,
  MemberSummary,
  ProviderOption,
} from "../types";
import { buildHouseholdApiPath, fetchJson } from "../utils";

export const memberKeys = {
  all: (slug: string) => ["members", slug] as const,
  members: (slug: string) => ["members", slug, "list"] as const,
  invitations: (slug: string) => ["members", slug, "invitations"] as const,
};

export type MembersResponse = {
  members: MemberSummary[];
  providers: ProviderOption[];
};

export function membersOptions(slug: string) {
  return queryOptions({
    queryKey: memberKeys.members(slug),
    queryFn: () =>
      fetchJson<MembersResponse>(buildHouseholdApiPath(slug, "/admin/members")),
  });
}

export function invitationsOptions(slug: string) {
  return queryOptions({
    queryKey: memberKeys.invitations(slug),
    queryFn: async () => {
      const response = await fetchJson<{ invitations: InvitationSummary[] }>(
        buildHouseholdApiPath(slug, "/admin/invitations"),
      );
      return response.invitations;
    },
  });
}

export function useMembers(slug: string | null | undefined) {
  return useQuery({ ...membersOptions(slug ?? ""), enabled: Boolean(slug) });
}

export function useInvitations(slug: string | null | undefined) {
  return useQuery({
    ...invitationsOptions(slug ?? ""),
    enabled: Boolean(slug),
  });
}

function useInvalidateMembers(slug: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: memberKeys.all(slug) });
}

export function useCreateInvitation(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (input: {
      email: string;
      name: string;
      role: "member" | "owner";
      providerIds: string[];
    }) =>
      fetchJson<InvitationDeliveryResponse>(
        buildHouseholdApiPath(slug, "/admin/invitations"),
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: invalidate,
  });
}

export function useResendInvitation(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (invitationId: string) =>
      fetchJson<InvitationDeliveryResponse>(
        buildHouseholdApiPath(
          slug,
          `/admin/invitations/${invitationId}/resend`,
        ),
        { method: "POST" },
      ),
    onSuccess: invalidate,
  });
}

export function useCancelInvitation(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (invitationId: string) =>
      fetchJson<{ ok: boolean }>(
        buildHouseholdApiPath(slug, `/admin/invitations/${invitationId}`),
        { method: "DELETE" },
      ),
    onSuccess: invalidate,
  });
}

export function useRemoveMember(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (userId: string) =>
      fetchJson<{ ok: boolean }>(
        buildHouseholdApiPath(slug, `/admin/members/${userId}`),
        { method: "DELETE" },
      ),
    onSuccess: invalidate,
  });
}

export function useChangeMemberRole(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (input: { userId: string; role: "member" | "owner" }) =>
      fetchJson<{ ok: boolean }>(
        buildHouseholdApiPath(slug, `/admin/members/${input.userId}/role`),
        { method: "PATCH", body: JSON.stringify({ role: input.role }) },
      ),
    onSuccess: invalidate,
  });
}

/** Grant and revoke service access in one go (the dialog saves a checkbox list). */
export function useSetMemberAccess(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      grant: string[];
      revoke: string[];
    }) => {
      for (const providerKey of input.grant) {
        await fetchJson<{ ok: boolean }>(
          buildHouseholdApiPath(
            slug,
            `/admin/members/${input.userId}/provider-access`,
          ),
          { method: "POST", body: JSON.stringify({ providerKey }) },
        );
      }
      for (const providerKey of input.revoke) {
        await fetchJson<{ ok: boolean }>(
          buildHouseholdApiPath(
            slug,
            `/admin/members/${input.userId}/provider-access/${encodeURIComponent(providerKey)}`,
          ),
          { method: "DELETE" },
        );
      }
    },
    onSuccess: invalidate,
  });
}
