import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client, unwrap } from "../lib/api";
import type {
  InvitationDeliveryResponse,
  InvitationSummary,
  MemberSummary,
  ProviderOption,
} from "../types";

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
      unwrap<MembersResponse>(
        client.GET("/api/admin/{slug}/members", { params: { path: { slug } } }),
      ),
  });
}

export function invitationsOptions(slug: string) {
  return queryOptions({
    queryKey: memberKeys.invitations(slug),
    queryFn: async () => {
      const response = await unwrap<{ invitations: InvitationSummary[] }>(
        client.GET("/api/admin/{slug}/invitations", {
          params: { path: { slug } },
        }),
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
      unwrap<InvitationDeliveryResponse>(
        client.POST("/api/admin/{slug}/invitations", {
          params: { path: { slug } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useResendInvitation(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (invitationId: string) =>
      unwrap<InvitationDeliveryResponse>(
        client.POST("/api/admin/{slug}/invitations/{invitationId}/resend", {
          params: { path: { slug, invitationId } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useCancelInvitation(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (invitationId: string) =>
      unwrap<{ ok: boolean }>(
        client.DELETE("/api/admin/{slug}/invitations/{invitationId}", {
          params: { path: { slug, invitationId } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useRemoveMember(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap<{ ok: boolean }>(
        client.DELETE("/api/admin/{slug}/members/{userId}", {
          params: { path: { slug, userId } },
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useChangeMemberRole(slug: string) {
  const invalidate = useInvalidateMembers(slug);
  return useMutation({
    mutationFn: (input: { userId: string; role: "member" | "owner" }) =>
      unwrap<{ ok: boolean }>(
        client.PATCH("/api/admin/{slug}/members/{userId}/role", {
          params: { path: { slug, userId: input.userId } },
          body: { role: input.role },
        }),
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
        await unwrap<{ ok: boolean }>(
          client.POST("/api/admin/{slug}/members/{userId}/provider-access", {
            params: { path: { slug, userId: input.userId } },
            body: { providerKey },
          }),
        );
      }
      for (const providerKey of input.revoke) {
        await unwrap<{ ok: boolean }>(
          client.DELETE(
            "/api/admin/{slug}/members/{userId}/provider-access/{providerKey}",
            {
              params: { path: { slug, userId: input.userId, providerKey } },
            },
          ),
        );
      }
    },
    onSuccess: invalidate,
  });
}
