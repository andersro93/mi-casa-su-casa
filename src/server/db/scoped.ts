import {
  cancelInvitation,
  createHouseholdInvitation,
  getInvitationById,
  getProvidersByIds,
  getProvidersForInvitation,
  listHouseholdInvitations,
  refreshExpiredInvitations,
  replaceInvitationProviders,
} from "./repositories/invitations";
import {
  grantProviderAccess,
  listMemberProviderAccess,
  listMembers,
  listProviders,
  revokeProviderAccess,
} from "./repositories/member-access";
import {
  countUnreviewedQuarantine,
  listMessagesForProvider,
  listQuarantineMessages,
  type PageOptions,
  reviewQuarantineMessage,
  updateMessageStatus,
} from "./repositories/messages";
import {
  createProvider,
  createSenderRule,
  deleteProvider,
  deleteSenderRule,
  getProviderById,
  getProviderByKey,
  getSenderRuleById,
  listProviderConfigurations,
  listSenderRules,
  updateProvider,
  updateSenderRule,
  userHasProviderAccess,
} from "./repositories/provider-rules";

type Tail<F> = F extends (
  db: D1Database,
  householdId: string,
  ...rest: infer R
) => infer O
  ? (...rest: R) => O
  : never;

function bind<
  F extends (db: D1Database, householdId: string, ...rest: never[]) => unknown,
>(db: D1Database, householdId: string, fn: F): Tail<F> {
  const call = fn as unknown as (...args: unknown[]) => unknown;
  return ((...rest: unknown[]) => call(db, householdId, ...rest)) as Tail<F>;
}

/**
 * Repository functions with the household pre-bound. Route handlers that work
 * through `c.get("repo")` cannot forget the tenant predicate: every function
 * here takes the household from the resolved membership, never from input.
 */
export function forHousehold(db: D1Database, householdId: string) {
  return {
    householdId,
    providers: {
      list: bind(db, householdId, listProviderConfigurations),
      byKey: bind(db, householdId, getProviderByKey),
      byId: bind(db, householdId, getProviderById),
      byIds: bind(db, householdId, getProvidersByIds),
      create: bind(db, householdId, createProvider),
      update: bind(db, householdId, updateProvider),
      remove: bind(db, householdId, deleteProvider),
      userHasAccess: bind(db, householdId, userHasProviderAccess),
    },
    senderRules: {
      list: bind(db, householdId, listSenderRules),
      byId: bind(db, householdId, getSenderRuleById),
      create: bind(db, householdId, createSenderRule),
      update: bind(db, householdId, updateSenderRule),
      remove: bind(db, householdId, deleteSenderRule),
    },
    members: {
      list: bind(db, householdId, listMembers),
      providerAccess: bind(db, householdId, listMemberProviderAccess),
      providers: bind(db, householdId, listProviders),
      grantProviderAccess: bind(db, householdId, grantProviderAccess),
      revokeProviderAccess: bind(db, householdId, revokeProviderAccess),
    },
    invitations: {
      list: () => listHouseholdInvitations(db, householdId),
      byId: (invitationId: string) =>
        getInvitationById(db, householdId, invitationId),
      providersFor: (invitationId: string) =>
        getProvidersForInvitation(db, invitationId),
      create: (
        input: Omit<
          Parameters<typeof createHouseholdInvitation>[1],
          "householdId"
        >,
      ) => createHouseholdInvitation(db, { ...input, householdId }),
      cancel: (invitationId: string) => cancelInvitation(db, invitationId),
      replaceProviders: (invitationId: string, providerIds: string[]) =>
        replaceInvitationProviders(db, invitationId, providerIds),
      refreshExpired: (now: Date = new Date()) =>
        refreshExpiredInvitations(db, now, householdId),
    },
    messages: {
      listForProvider: (providerKey: string, page?: PageOptions) =>
        listMessagesForProvider(db, householdId, providerKey, page),
      updateStatus: bind(db, householdId, updateMessageStatus),
    },
    quarantine: {
      list: (page?: PageOptions) =>
        listQuarantineMessages(db, householdId, page),
      countUnreviewed: () => countUnreviewedQuarantine(db, householdId),
      review: bind(db, householdId, reviewQuarantineMessage),
    },
  };
}

export type HouseholdRepository = ReturnType<typeof forHousehold>;
