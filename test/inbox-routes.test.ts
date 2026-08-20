import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionUser = {
  id: string;
  email: string;
  role: string;
  name?: string;
};

type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: string;
};

type HouseholdRecord = {
  id: string;
  slug: string;
  displayName: string;
};

type MembershipRecord = {
  householdId: string;
  userId: string;
  role: "owner" | "member";
};

type ProviderRecord = {
  id: string;
  household_id: string;
  provider_key: string;
  display_name: string;
  created_at?: string;
  rule_count?: number;
};

type InvitationRecord = {
  id: string;
  householdId: string;
  email: string;
  name: string;
  role: "owner" | "member";
  status: "pending" | "accepted" | "cancelled" | "expired";
  invitedByUserId: string;
  acceptedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  tokenHash: string;
  providerIds: string[];
};

const sessionState = vi.hoisted(() => ({
  current: null as {
    user: SessionUser;
    session: { id: string; userId: string };
  } | null,
}));

const authApiState = vi.hoisted(() => ({
  signUpEmailCalls: [] as unknown[],
}));

const invitationEmailState = vi.hoisted(() => ({
  calls: [] as Array<{ env: unknown; input: Record<string, unknown> }>,
  failWith: null as string | null,
}));

const repoState = vi.hoisted(() => ({
  users: [] as UserRecord[],
  households: [] as HouseholdRecord[],
  memberships: [] as MembershipRecord[],
  providers: [] as ProviderRecord[],
  providerAccess: [] as Array<{
    householdId: string;
    userId: string;
    providerId: string;
  }>,
  messages: [] as Array<{
    id: string;
    household_slug: string;
    householdId: string;
    provider_key: string;
    provider_display_name: string;
    subject: string;
    from_header: string;
    text_body: string;
    extracted_code: string | null;
    status: "new" | "used" | "expired";
    received_at: string;
  }>,
  quarantine: [] as Array<{
    id: string;
    household_slug: string;
    householdId: string;
    provider_key: string;
    provider_display_name: string;
    subject: string;
    from_header: string;
    envelope_from: string;
    text_body: string;
    extracted_code: string | null;
    quarantine_reason: string;
    received_at: string;
    reviewed: boolean;
  }>,
  invitations: [] as InvitationRecord[],
  senderRules: [] as Array<{
    id: string;
    household_id: string;
    provider_id: string;
    match_type: "exact" | "domain";
    match_value: string;
    created_at: string;
  }>,
  createHouseholdCalls: [] as unknown[],
  createInvitationCalls: [] as unknown[],
  acceptInvitationCalls: [] as unknown[],
  updateRoleCalls: [] as unknown[],
  grantAccessCalls: [] as unknown[],
  reviewCalls: [] as unknown[],
  setupState: {
    status: "pending",
    owner_user_id: null,
    owner_email: null,
  } as {
    status: "pending" | "in_progress" | "complete";
    owner_user_id: string | null;
    owner_email: string | null;
  },
  beginSetupResult: true,
}));

function getUser(userId: string) {
  return repoState.users.find((user) => user.id === userId) ?? null;
}

function getHouseholdBySlug(slug: string) {
  return (
    repoState.households.find((household) => household.slug === slug) ?? null
  );
}

function getHouseholdByIdValue(id: string) {
  return repoState.households.find((household) => household.id === id) ?? null;
}

function getMembership(userId: string, householdId: string) {
  return (
    repoState.memberships.find(
      (membership) =>
        membership.userId === userId && membership.householdId === householdId,
    ) ?? null
  );
}

function getInvitationProviders(providerIds: string[]) {
  return providerIds
    .map((providerId) =>
      repoState.providers.find((provider) => provider.id === providerId),
    )
    .filter((provider): provider is ProviderRecord => Boolean(provider))
    .map((provider) => ({
      id: provider.id,
      provider_key: provider.provider_key,
      display_name: provider.display_name,
    }));
}

function invitationSummary(invitation: InvitationRecord) {
  return {
    id: invitation.id,
    householdId: invitation.householdId,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    status: invitation.status,
    invitedByUserId: invitation.invitedByUserId,
    acceptedByUserId: invitation.acceptedByUserId,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    cancelledAt: invitation.cancelledAt,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
    providers: getInvitationProviders(invitation.providerIds),
  };
}

vi.mock("../src/server/email/sender", () => ({
  sendHouseholdInvitationEmail: async (
    env: unknown,
    input: Record<string, unknown>,
  ) => {
    invitationEmailState.calls.push({ env, input });
    if (invitationEmailState.failWith) {
      throw new Error(invitationEmailState.failWith);
    }
  },
  sendPasswordResetEmail: async () => {},
  sendTransactionalEmail: async () => {},
}));

vi.mock("../src/server/security/tokens", () => ({
  createInvitationToken: async () => ({
    token: "invite-token",
    tokenHash: "hash:invite-token",
  }),
  hashInvitationToken: async (token: string) => `hash:${token}`,
}));

vi.mock("../src/server/db/repositories/installation-state", () => ({
  getInstallationState: async () => ({
    id: 1,
    status: repoState.setupState.status,
    owner_user_id: repoState.setupState.owner_user_id,
    owner_email: repoState.setupState.owner_email,
    completed_at: null,
    created_at: "2026-05-10T12:00:00.000Z",
    updated_at: "2026-05-10T12:00:00.000Z",
  }),
  beginInstallationSetup: async () => repoState.beginSetupResult,
  completeInstallationSetup: async (
    _db: D1Database,
    ownerUserId: string,
    ownerEmail: string,
  ) => {
    repoState.setupState = {
      status: "complete",
      owner_user_id: ownerUserId,
      owner_email: ownerEmail,
    };
  },
  resetInstallationSetup: async () => {
    repoState.setupState = {
      status: "pending",
      owner_user_id: null,
      owner_email: null,
    };
  },
}));

vi.mock("../src/server/db/repositories/households", async () => {
  const actual = await vi.importActual<
    typeof import("../src/server/db/repositories/households")
  >("../src/server/db/repositories/households");

  return {
    ...actual,
    listHouseholdsForUser: async (_db: D1Database, userId: string) =>
      repoState.memberships
        .filter((membership) => membership.userId === userId)
        .map((membership) => {
          const household = getHouseholdByIdValue(membership.householdId);
          return {
            id: membership.householdId,
            slug: household?.slug ?? "unknown",
            displayName: household?.displayName ?? "Unknown",
            role: membership.role,
          };
        }),
    userBelongsToHousehold: async (
      _db: D1Database,
      userId: string,
      householdSlug: string,
    ) => {
      const household = getHouseholdBySlug(householdSlug);
      if (!household) return null;
      const membership = getMembership(userId, household.id);
      if (!membership) return null;
      return {
        householdId: household.id,
        role: membership.role,
        slug: household.slug,
      };
    },
    getHouseholdMembership: async (
      _db: D1Database,
      userId: string,
      householdId: string,
    ) => {
      const membership = getMembership(userId, householdId);
      const household = getHouseholdByIdValue(householdId);
      if (!membership || !household) return null;
      return {
        householdId,
        userId,
        role: membership.role,
        slug: household.slug,
        displayName: household.displayName,
      };
    },
    updateHouseholdMembershipRole: async (
      _db: D1Database,
      input: { householdId: string; userId: string; role: "owner" | "member" },
    ) => {
      repoState.updateRoleCalls.push(input);
      const membership = getMembership(input.userId, input.householdId);
      if (membership) {
        membership.role = input.role;
      }
    },
    createHousehold: async (
      _db: D1Database,
      input: { slug: string; displayName: string; ownerUserId: string },
    ) => {
      repoState.createHouseholdCalls.push(input);
      const household = {
        id: "household-created",
        slug: input.slug,
        displayName: input.displayName,
      };
      repoState.households.push(household);
      repoState.memberships.push({
        householdId: household.id,
        userId: input.ownerUserId,
        role: "owner",
      });
      return household;
    },
    getHouseholdById: async (_db: D1Database, id: string) =>
      getHouseholdByIdValue(id),
    getHouseholdSettings: async (_db: D1Database, householdId: string) => {
      const household = getHouseholdByIdValue(householdId);

      if (!household) {
        return null;
      }

      return {
        id: household.id,
        slug: household.slug,
        displayName: household.displayName,
        createdAt: "2026-05-10T12:00:00.000Z",
        updatedAt: "2026-05-10T12:00:00.000Z",
      };
    },
    updateHouseholdDisplayName: async (
      _db: D1Database,
      householdId: string,
      displayName: string,
    ) => {
      const household = getHouseholdByIdValue(householdId);

      if (!household) {
        return null;
      }

      household.displayName = displayName;

      return {
        id: household.id,
        slug: household.slug,
        displayName: household.displayName,
        createdAt: "2026-05-10T12:00:00.000Z",
        updatedAt: "2026-05-10T12:00:00.000Z",
      };
    },
    assertProvidersBelongToHousehold: async (
      _db: D1Database,
      householdId: string,
      providerIds: string[],
    ) =>
      providerIds.every((providerId) =>
        repoState.providers.some(
          (provider) =>
            provider.id === providerId && provider.household_id === householdId,
        ),
      ),
  };
});

vi.mock("../src/server/db/repositories/member-access", () => ({
  listMembers: async (_db: D1Database, householdId: string) =>
    repoState.memberships
      .filter((membership) => membership.householdId === householdId)
      .map((membership) => {
        const user = getUser(membership.userId);
        return {
          id: membership.userId,
          householdRole: membership.role,
          email: user?.email ?? `${membership.userId}@example.com`,
          name: user?.name ?? membership.userId,
          role: user?.role ?? "user",
          createdAt: "2026-05-10T12:00:00.000Z",
          updatedAt: "2026-05-10T12:00:00.000Z",
        };
      }),
  listMemberProviderAccess: async (_db: D1Database, householdId: string) =>
    repoState.memberships.flatMap((membership) => {
      if (membership.householdId !== householdId) return [];
      const user = getUser(membership.userId);
      const accessRows = repoState.providerAccess.filter(
        (entry) =>
          entry.householdId === householdId &&
          entry.userId === membership.userId,
      );
      if (accessRows.length === 0) {
        return [
          {
            id: membership.userId,
            household_role: membership.role,
            email: user?.email ?? `${membership.userId}@example.com`,
            name: user?.name ?? membership.userId,
            role: user?.role ?? "user",
            provider_key: null,
            provider_display_name: null,
          },
        ];
      }
      return accessRows.map((entry) => {
        const provider = repoState.providers.find(
          (candidate) => candidate.id === entry.providerId,
        );
        return {
          id: membership.userId,
          household_role: membership.role,
          email: user?.email ?? `${membership.userId}@example.com`,
          name: user?.name ?? membership.userId,
          role: user?.role ?? "user",
          provider_key: provider?.provider_key ?? null,
          provider_display_name: provider?.display_name ?? null,
        };
      });
    }),
  listProviders: async (_db: D1Database, householdId: string) =>
    repoState.providers.filter(
      (provider) => provider.household_id === householdId,
    ),
  grantProviderAccess: async (
    _db: D1Database,
    householdId: string,
    userId: string,
    providerId: string,
  ) => {
    repoState.grantAccessCalls.push({ householdId, userId, providerId });
    repoState.providerAccess.push({ householdId, userId, providerId });
  },
  revokeProviderAccess: async (
    _db: D1Database,
    householdId: string,
    userId: string,
    providerId: string,
  ) => {
    repoState.providerAccess = repoState.providerAccess.filter(
      (entry) =>
        !(
          entry.householdId === householdId &&
          entry.userId === userId &&
          entry.providerId === providerId
        ),
    );
  },
}));

vi.mock("../src/server/db/repositories/provider-rules", () => ({
  userHasProviderAccess: async (
    _db: D1Database,
    householdId: string,
    userId: string,
    providerKey: string,
  ) => {
    const provider = repoState.providers.find(
      (candidate) =>
        candidate.household_id === householdId &&
        candidate.provider_key === providerKey,
    );
    if (!provider) return false;
    return repoState.providerAccess.some(
      (entry) =>
        entry.householdId === householdId &&
        entry.userId === userId &&
        entry.providerId === provider.id,
    );
  },
  getProviderByKey: async (
    _db: D1Database,
    householdId: string,
    providerKey: string,
  ) =>
    repoState.providers.find(
      (provider) =>
        provider.household_id === householdId &&
        provider.provider_key === providerKey,
    ) ?? null,
  getProviderById: async (
    _db: D1Database,
    householdId: string,
    providerId: string,
  ) =>
    repoState.providers.find(
      (provider) =>
        provider.household_id === householdId && provider.id === providerId,
    ) ?? null,
  listProviderConfigurations: async (_db: D1Database, householdId: string) =>
    repoState.providers
      .filter((provider) => provider.household_id === householdId)
      .map((provider) => ({
        ...provider,
        rule_count: provider.rule_count ?? 0,
      })),
  listSenderRules: async (_db: D1Database, householdId: string) =>
    repoState.senderRules.filter((rule) => rule.household_id === householdId),
  createProvider: async (
    _db: D1Database,
    householdId: string,
    providerKey: string,
    displayName: string,
  ) => {
    const provider = {
      id: `provider-${repoState.providers.length + 1}`,
      household_id: householdId,
      provider_key: providerKey,
      display_name: displayName,
      created_at: "2026-05-10T12:00:00.000Z",
      rule_count: 0,
    };
    repoState.providers.push(provider);
    return provider;
  },
  createSenderRule: async (
    _db: D1Database,
    householdId: string,
    providerId: string,
    matchType: "exact" | "domain",
    matchValue: string,
  ) => {
    const rule = {
      id: `rule-${repoState.senderRules.length + 1}`,
      household_id: householdId,
      provider_id: providerId,
      match_type: matchType,
      match_value: matchValue,
      created_at: "2026-05-10T12:00:00.000Z",
    };
    repoState.senderRules.push(rule);
    return rule;
  },
  updateProvider: async () => {},
  updateSenderRule: async () => {},
  deleteProvider: async () => {},
  deleteSenderRule: async () => {},
  getSenderRuleById: async () => null,
}));

vi.mock("../src/server/db/repositories/messages", () => ({
  listProviderSummariesForUser: async (
    _db: D1Database,
    householdId: string,
    userId: string,
  ) => {
    const membership = getMembership(userId, householdId);
    if (!membership) return [];
    const visibleProviders = repoState.providers.filter((provider) => {
      if (provider.household_id !== householdId) return false;
      if (membership.role === "owner") return true;
      return repoState.providerAccess.some(
        (entry) =>
          entry.householdId === householdId &&
          entry.userId === userId &&
          entry.providerId === provider.id,
      );
    });

    return visibleProviders.map((provider) => {
      const providerMessages = repoState.messages.filter(
        (message) =>
          message.householdId === householdId &&
          message.provider_key === provider.provider_key,
      );
      return {
        household_slug: getHouseholdByIdValue(householdId)?.slug ?? "unknown",
        provider_key: provider.provider_key,
        display_name: provider.display_name,
        message_count: providerMessages.length,
        new_count: providerMessages.filter(
          (message) => message.status === "new",
        ).length,
        latest_received_at: providerMessages[0]?.received_at ?? null,
      };
    });
  },
  listMessagesForProvider: async (
    _db: D1Database,
    householdId: string,
    providerKey: string,
  ) =>
    repoState.messages.filter(
      (message) =>
        message.householdId === householdId &&
        message.provider_key === providerKey,
    ),
  findMessageById: async (
    _db: D1Database,
    householdId: string,
    messageId: string,
  ) =>
    repoState.messages.find(
      (message) =>
        message.householdId === householdId && message.id === messageId,
    ) ?? null,
  updateMessageStatus: async (
    _db: D1Database,
    householdId: string,
    messageId: string,
    status: "new" | "used" | "expired",
  ) => {
    const message = repoState.messages.find(
      (candidate) =>
        candidate.householdId === householdId && candidate.id === messageId,
    );
    if (!message) return null;
    message.status = status;
    return message;
  },
  listQuarantineMessages: async (_db: D1Database, householdId: string) =>
    repoState.quarantine.filter(
      (message) => message.householdId === householdId && !message.reviewed,
    ),
  reviewQuarantineMessage: async (
    _db: D1Database,
    householdId: string,
    messageId: string,
    input: { action: "dismiss" | "release"; providerId?: string },
  ) => {
    repoState.reviewCalls.push({ householdId, messageId, input });
    const message = repoState.quarantine.find(
      (candidate) =>
        candidate.householdId === householdId && candidate.id === messageId,
    );
    if (!message) return null;
    message.reviewed = true;
    if (input.action === "release") {
      const provider = repoState.providers.find(
        (candidate) => candidate.id === input.providerId,
      );
      return {
        reviewedAt: "2026-05-10T12:30:00.000Z",
        releasedMessage: {
          id: "released-1",
          provider_key: provider?.provider_key ?? "unknown",
          status: "new",
        },
      };
    }
    return {
      reviewedAt: "2026-05-10T12:30:00.000Z",
      dismissed: true,
    };
  },
}));

vi.mock("../src/server/db/repositories/invitations", async () => {
  const actual = await vi.importActual<
    typeof import("../src/server/db/repositories/invitations")
  >("../src/server/db/repositories/invitations");

  return {
    ...actual,
    createHouseholdInvitation: async (
      _db: D1Database,
      input: {
        householdId: string;
        email: string;
        name: string;
        role: "owner" | "member";
        tokenHash: string;
        invitedByUserId: string;
        expiresAt: string;
        providerIds: string[];
      },
    ) => {
      repoState.createInvitationCalls.push(input);
      const invitationId = `invite-${repoState.invitations.length + 1}`;
      repoState.invitations.push({
        id: invitationId,
        householdId: input.householdId,
        email: input.email,
        name: input.name,
        role: input.role,
        status: "pending",
        invitedByUserId: input.invitedByUserId,
        acceptedByUserId: null,
        expiresAt: input.expiresAt,
        acceptedAt: null,
        cancelledAt: null,
        createdAt: "2026-05-10T12:00:00.000Z",
        updatedAt: "2026-05-10T12:00:00.000Z",
        tokenHash: input.tokenHash,
        providerIds: input.providerIds,
      });
      return invitationId;
    },
    getInvitationById: async (_db: D1Database, invitationId: string) => {
      const invitation = repoState.invitations.find(
        (candidate) => candidate.id === invitationId,
      );
      return invitation ? invitationSummary(invitation) : null;
    },
    getInvitationByTokenHash: async (_db: D1Database, tokenHash: string) => {
      const invitation = repoState.invitations.find(
        (candidate) => candidate.tokenHash === tokenHash,
      );
      return invitation ? invitationSummary(invitation) : null;
    },
    listHouseholdInvitations: async (_db: D1Database, householdId?: string) =>
      repoState.invitations
        .filter((invitation) =>
          householdId ? invitation.householdId === householdId : true,
        )
        .map(invitationSummary),
    refreshExpiredInvitations: async () => {},
    cancelInvitation: async (_db: D1Database, invitationId: string) => {
      const invitation = repoState.invitations.find(
        (candidate) => candidate.id === invitationId,
      );
      if (invitation) {
        invitation.status = "cancelled";
      }
    },
    acceptInvitation: async (
      _db: D1Database,
      input: {
        invitationId: string;
        householdId: string;
        acceptedByUserId: string;
        role: "owner" | "member";
      },
    ) => {
      repoState.acceptInvitationCalls.push(input);
      repoState.memberships.push({
        householdId: input.householdId,
        userId: input.acceptedByUserId,
        role: input.role,
      });
      const invitation = repoState.invitations.find(
        (candidate) => candidate.id === input.invitationId,
      );
      if (invitation) {
        invitation.status = "accepted";
        invitation.acceptedByUserId = input.acceptedByUserId;
      }
    },
  };
});

vi.mock("../src/server/auth/auth", () => ({
  authForEnv: () => ({
    handler: () => new Response("auth"),
    api: {
      getSession: async () => sessionState.current,
    },
  }),
  provisioningAuthForEnv: () => ({
    handler: () => new Response("auth"),
    api: {
      signUpEmail: async (input: unknown) => {
        authApiState.signUpEmailCalls.push(input);
        const body = (input as { body: { email: string; name: string } }).body;
        const createdUser = {
          id: "created-user-1",
          email: body.email,
          name: body.name,
          role: "user",
        };
        repoState.users.push(createdUser);
        return {
          response: {
            user: createdUser,
            session: {
              id: "session-created-1",
              userId: createdUser.id,
            },
          },
          headers: {
            getSetCookie: () => [
              "better-auth.session_token=test-token; Path=/; HttpOnly",
            ],
          },
        };
      },
    },
  }),
}));

const { default: worker } = await import("../src/index");

type WorkerFetch = NonNullable<typeof worker.fetch>;

function createDbStub(): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return {
            all: async () => ({ results: [] }),
            first: async () => null,
            raw: async () => [],
            run: async () => ({ results: [] }),
          };
        },
        all: async () => ({ results: [] }),
        first: async () => null,
        raw: async () => [],
        run: async () => ({ results: [] }),
      };
    },
    batch: async () => [],
  } as unknown as D1Database;
}

function createEnv(db: D1Database, overrides?: Partial<Env>): Env {
  const assets = {
    fetch: async () => new Response("spa"),
  } as unknown as Fetcher;

  const email = {
    send: async () => {},
  } as unknown as SendEmail;

  return {
    APP_NAME: "Mi Casa Su Casa",
    APP_URL: "http://localhost:8787",
    ASSETS: assets,
    AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
    DB: db,
    EMAIL: email,
    ENVIRONMENT: "test",
    OUTBOUND_EMAIL_FROM: "noreply@example.com",
    OWNER_EMAIL: "owner@example.com",
    SETUP_SECRET: "setup-secret",
    ...overrides,
  };
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function getWorkerFetch(): WorkerFetch {
  if (!worker.fetch) {
    throw new Error("Worker fetch handler is unavailable");
  }
  return worker.fetch;
}

async function invokeWorker(
  path: string,
  options?: RequestInit,
  envOverrides?: Partial<Env>,
) {
  const fetchHandler = getWorkerFetch();
  const db = createDbStub();
  const request = new Request(
    `http://localhost:8787${path}`,
    options,
  ) as Parameters<WorkerFetch>[0];
  return fetchHandler(
    request,
    createEnv(db, envOverrides),
    createExecutionContext(),
  );
}

describe("worker routes", () => {
  beforeEach(() => {
    sessionState.current = null;
    authApiState.signUpEmailCalls = [];
    invitationEmailState.calls = [];
    invitationEmailState.failWith = null;
    repoState.users = [
      {
        id: "owner-home",
        email: "owner@example.com",
        name: "Home Owner",
        role: "user",
      },
      {
        id: "member-home",
        email: "member@example.com",
        name: "Household Member",
        role: "user",
      },
      {
        id: "owner-away",
        email: "away-owner@example.com",
        name: "Away Owner",
        role: "user",
      },
      {
        id: "member-away",
        email: "away-member@example.com",
        name: "Away Member",
        role: "user",
      },
    ];
    repoState.households = [
      { id: "household-home", slug: "home", displayName: "Home" },
      { id: "household-away", slug: "away", displayName: "Away" },
    ];
    repoState.memberships = [
      { householdId: "household-home", userId: "owner-home", role: "owner" },
      { householdId: "household-home", userId: "member-home", role: "member" },
      { householdId: "household-away", userId: "owner-away", role: "owner" },
      { householdId: "household-away", userId: "member-away", role: "member" },
    ];
    repoState.providers = [
      {
        id: "provider-home-netflix",
        household_id: "household-home",
        provider_key: "netflix",
        display_name: "Netflix",
        created_at: "2026-05-10T12:00:00.000Z",
        rule_count: 1,
      },
      {
        id: "provider-away-hulu",
        household_id: "household-away",
        provider_key: "hulu",
        display_name: "Hulu",
        created_at: "2026-05-10T12:00:00.000Z",
        rule_count: 0,
      },
    ];
    repoState.providerAccess = [
      {
        householdId: "household-home",
        userId: "member-home",
        providerId: "provider-home-netflix",
      },
    ];
    repoState.messages = [
      {
        id: "msg-home-1",
        household_slug: "home",
        householdId: "household-home",
        provider_key: "netflix",
        provider_display_name: "Netflix",
        subject: "Your code",
        from_header: "Netflix <no-reply@netflix.com>",
        text_body: "Code 123456",
        extracted_code: "123456",
        status: "new",
        received_at: "2026-05-10T12:00:00.000Z",
      },
    ];
    repoState.quarantine = [
      {
        id: "quarantine-home-1",
        household_slug: "home",
        householdId: "household-home",
        provider_key: "quarantine",
        provider_display_name: "Quarantine",
        subject: "Review this",
        from_header: "Unknown <unknown@example.com>",
        envelope_from: "unknown@example.com",
        text_body: "Unclassified message",
        extracted_code: null,
        quarantine_reason: "unknown_sender",
        received_at: "2026-05-10T12:10:00.000Z",
        reviewed: false,
      },
    ];
    repoState.invitations = [
      {
        id: "invite-existing",
        householdId: "household-home",
        email: "invitee@example.com",
        name: "Invitee",
        role: "member",
        status: "pending",
        invitedByUserId: "owner-home",
        acceptedByUserId: null,
        expiresAt: "2099-05-31T12:00:00.000Z",
        acceptedAt: null,
        cancelledAt: null,
        createdAt: "2026-05-10T12:00:00.000Z",
        updatedAt: "2026-05-10T12:00:00.000Z",
        tokenHash: "hash:test-token",
        providerIds: ["provider-home-netflix"],
      },
    ];
    repoState.senderRules = [
      {
        id: "rule-home-1",
        household_id: "household-home",
        provider_id: "provider-home-netflix",
        match_type: "domain",
        match_value: "netflix.com",
        created_at: "2026-05-10T12:00:00.000Z",
      },
    ];
    repoState.createHouseholdCalls = [];
    repoState.createInvitationCalls = [];
    repoState.acceptInvitationCalls = [];
    repoState.updateRoleCalls = [];
    repoState.grantAccessCalls = [];
    repoState.reviewCalls = [];
    repoState.setupState = {
      status: "pending",
      owner_user_id: null,
      owner_email: null,
    };
    repoState.beginSetupResult = true;
  });

  it("lists providers for a member in their own household", async () => {
    sessionState.current = {
      user: { id: "member-home", email: "member@example.com", role: "user" },
      session: { id: "session-1", userId: "member-home" },
    };

    const response = await invokeWorker("/api/inbox/home/providers");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers: [
        {
          household_slug: "home",
          provider_key: "netflix",
          display_name: "Netflix",
          message_count: 1,
          new_count: 1,
          latest_received_at: "2026-05-10T12:00:00.000Z",
        },
      ],
    });
  });

  it("denies inbox access across household boundaries", async () => {
    sessionState.current = {
      user: {
        id: "owner-away",
        email: "away-owner@example.com",
        role: "user",
      },
      session: { id: "session-1", userId: "owner-away" },
    };

    const response = await invokeWorker("/api/inbox/home/providers");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("allows a permitted member to update message status in their household", async () => {
    sessionState.current = {
      user: { id: "member-home", email: "member@example.com", role: "user" },
      session: { id: "session-1", userId: "member-home" },
    };

    const response = await invokeWorker(
      "/api/inbox/home/messages/msg-home-1/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "used" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: expect.objectContaining({ id: "msg-home-1", status: "used" }),
    });
  });

  it("denies quarantine review to members in the same household", async () => {
    sessionState.current = {
      user: { id: "member-home", email: "member@example.com", role: "user" },
      session: { id: "session-1", userId: "member-home" },
    };

    const response = await invokeWorker("/api/inbox/home/quarantine");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("allows an owner to review quarantine within their household", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker(
      "/api/inbox/home/quarantine/quarantine-home-1/review",
      {
        method: "POST",
        body: JSON.stringify({ action: "release", providerKey: "netflix" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reviewedAt: "2026-05-10T12:30:00.000Z",
      releasedMessage: {
        id: "released-1",
        provider_key: "netflix",
        status: "new",
      },
    });
  });

  it("allows an owner to list members in their household", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker("/api/admin/home/members");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: [
        {
          id: "owner-home",
          email: "owner@example.com",
          name: "Home Owner",
          householdRole: "owner",
          role: "admin",
          createdAt: "2026-05-10T12:00:00.000Z",
          updatedAt: "2026-05-10T12:00:00.000Z",
          providerAccess: [],
        },
        {
          id: "member-home",
          email: "member@example.com",
          name: "Household Member",
          householdRole: "member",
          role: "member",
          createdAt: "2026-05-10T12:00:00.000Z",
          updatedAt: "2026-05-10T12:00:00.000Z",
          providerAccess: [
            {
              providerKey: "netflix",
              displayName: "Netflix",
            },
          ],
        },
      ],
      providers: [
        expect.objectContaining({
          id: "provider-home-netflix",
          provider_key: "netflix",
          display_name: "Netflix",
        }),
      ],
    });
  });

  it("allows an owner to read household settings for their household", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker("/api/admin/home/settings");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      household: {
        slug: "home",
        emailAddress: "home@DOMAIN",
        displayName: "Home",
        subscriptionPlan: "Free Plan",
      },
    });
  });

  it("allows an owner to update their household display name", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker("/api/admin/home/settings", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Renamed Home" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      household: {
        slug: "home",
        emailAddress: "home@DOMAIN",
        displayName: "Renamed Home",
        subscriptionPlan: "Free Plan",
      },
    });
    expect(
      repoState.households.find(
        (household) => household.id === "household-home",
      ),
    ).toMatchObject({ displayName: "Renamed Home" });
  });

  it("denies admin routes to members in the same household", async () => {
    sessionState.current = {
      user: { id: "member-home", email: "member@example.com", role: "user" },
      session: { id: "session-1", userId: "member-home" },
    };

    const response = await invokeWorker("/api/admin/home/members");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("denies household settings routes to members in the same household", async () => {
    sessionState.current = {
      user: { id: "member-home", email: "member@example.com", role: "user" },
      session: { id: "session-1", userId: "member-home" },
    };

    const response = await invokeWorker("/api/admin/home/settings");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects blank household display names", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker("/api/admin/home/settings", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "   " }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "displayName is required",
    });
  });

  it("denies admin routes across household boundaries even for another owner", async () => {
    sessionState.current = {
      user: {
        id: "owner-away",
        email: "away-owner@example.com",
        role: "user",
      },
      session: { id: "session-1", userId: "owner-away" },
    };

    const response = await invokeWorker("/api/admin/home/members");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("creates an invitation instead of provisioning a passworded member account", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker("/api/admin/home/members", {
      method: "POST",
      body: JSON.stringify({
        email: "new@example.com",
        name: "New Person",
        role: "member",
      }),
    });

    expect(response.status).toBe(201);
    expect(authApiState.signUpEmailCalls).toHaveLength(0);
    expect(repoState.createInvitationCalls).toHaveLength(1);
    expect(repoState.createInvitationCalls[0]).toMatchObject({
      householdId: "household-home",
      email: "new@example.com",
      name: "New Person",
      role: "member",
    });
    expect(invitationEmailState.calls).toHaveLength(1);
    await expect(response.json()).resolves.toEqual({
      invitation: expect.objectContaining({
        email: "new@example.com",
        role: "member",
        status: "pending",
      }),
      inviteUrl: "http://localhost:8787/invite/invite-token",
      emailSent: true,
    });
  });

  it("still creates the invitation and returns the link when the email cannot be sent", async () => {
    sessionState.current = {
      user: {
        id: "owner-home",
        email: "owner@example.com",
        role: "user",
        name: "Olivia Owner",
      },
      session: { id: "session-1", userId: "owner-home" },
    };
    invitationEmailState.failWith =
      "OUTBOUND_EMAIL_FROM must be configured before sending email.";

    const response = await invokeWorker("/api/admin/home/invitations", {
      method: "POST",
      body: JSON.stringify({
        email: "new@example.com",
        name: "New Person",
        role: "member",
        providerIds: [],
      }),
    });

    expect(response.status).toBe(201);
    expect(repoState.createInvitationCalls).toHaveLength(1);
    // The inviter's display name (not the email) is used in the message.
    expect(invitationEmailState.calls[0]?.input).toMatchObject({
      inviterName: "Olivia Owner",
      inviterEmail: "owner@example.com",
    });
    await expect(response.json()).resolves.toEqual({
      invitation: expect.objectContaining({ email: "new@example.com" }),
      inviteUrl: "http://localhost:8787/invite/invite-token",
      emailSent: false,
      emailError:
        "OUTBOUND_EMAIL_FROM must be configured before sending email.",
    });
  });

  it("rejects invitations to malformed email addresses", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker("/api/admin/home/invitations", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email", name: "Nope" }),
    });

    expect(response.status).toBe(400);
    expect(repoState.createInvitationCalls).toHaveLength(0);
    expect(invitationEmailState.calls).toHaveLength(0);
  });

  it("rejects role changes for a user outside the active household", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker(
      "/api/admin/home/members/member-away/role",
      {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Member not found",
    });
  });

  it("rejects provider-access changes for a user outside the active household", async () => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };

    const response = await invokeWorker(
      "/api/admin/home/members/member-away/provider-access",
      {
        method: "POST",
        body: JSON.stringify({ providerKey: "netflix" }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Member not found",
    });
  });

  it("accepts an invitation via provisioning signup and attaches the user to the invited household", async () => {
    const response = await invokeWorker("/api/invitations/test-token/accept", {
      method: "POST",
      body: JSON.stringify({
        name: "Invited Person",
        password: "super-secure-password",
      }),
    });

    expect(response.status).toBe(201);
    expect(authApiState.signUpEmailCalls).toHaveLength(1);
    expect(authApiState.signUpEmailCalls[0]).toMatchObject({
      body: {
        email: "invitee@example.com",
        name: "Invited Person",
        password: "super-secure-password",
      },
    });
    expect(repoState.acceptInvitationCalls).toEqual([
      {
        invitationId: "invite-existing",
        householdId: "household-home",
        acceptedByUserId: "created-user-1",
        role: "member",
      },
    ]);

    const payload = (await response.json()) as {
      member: { id: string; email: string; role: string };
      household: { slug: string };
    };

    expect(payload.member).toEqual({
      id: "created-user-1",
      email: "invitee@example.com",
      name: "Invited Person",
      role: "member",
    });
    expect(payload.household.slug).toBe("home");
    expect("session" in payload).toBe(false);
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=test-token",
    );
  });

  it("creates the initial owner through the provisioning signup flow", async () => {
    const response = await invokeWorker("/api/setup/complete", {
      method: "POST",
      body: JSON.stringify({
        email: "owner@example.com",
        name: "Owner Person",
        password: "super-secure-password",
        householdName: "Home",
        householdSlug: "home-setup",
        setupSecret: "setup-secret",
      }),
    });

    expect(response.status).toBe(201);
    expect(authApiState.signUpEmailCalls).toHaveLength(1);
    expect(authApiState.signUpEmailCalls[0]).toMatchObject({
      body: {
        email: "owner@example.com",
        name: "Owner Person",
        password: "super-secure-password",
      },
    });
    expect(repoState.createHouseholdCalls).toEqual([
      {
        slug: "home-setup",
        displayName: "Home",
        ownerUserId: "created-user-1",
      },
    ]);

    const payload = (await response.json()) as {
      member: { role: string; email: string };
      household: { slug: string };
    };

    expect(payload.member).toEqual({
      id: "created-user-1",
      email: "owner@example.com",
      name: "Owner Person",
      role: "owner",
    });
    expect(payload.household.slug).toBe("home-setup");
    expect("session" in payload).toBe(false);
  });
});

describe("cross-origin protections", () => {
  beforeEach(() => {
    sessionState.current = {
      user: { id: "owner-home", email: "owner@example.com", role: "user" },
      session: { id: "session-1", userId: "owner-home" },
    };
    invitationEmailState.calls = [];
    invitationEmailState.failWith = null;
  });

  it("does not reflect foreign origins in CORS headers", async () => {
    const response = await invokeWorker("/api/setup/status", {
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(200);
    // Without Allow-Origin the browser blocks the cross-origin read, whatever
    // Allow-Credentials says.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("grants credentialed CORS to the app's own origin", async () => {
    const response = await invokeWorker("/api/setup/status", {
      headers: { Origin: "http://localhost:8787" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:8787",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  it("rejects mutations that carry a foreign Origin or a cross-site fetch metadata header", async () => {
    const body = JSON.stringify({
      email: "new@example.com",
      name: "New Person",
      role: "member",
      providerIds: [],
    });

    const foreignOrigin = await invokeWorker("/api/admin/home/invitations", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "content-type": "application/json",
      },
      body,
    });
    expect(foreignOrigin.status).toBe(403);

    const crossSite = await invokeWorker("/api/admin/home/invitations", {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "cross-site",
        "content-type": "application/json",
      },
      body,
    });
    expect(crossSite.status).toBe(403);

    const foreignReferer = await invokeWorker("/api/admin/home/invitations", {
      method: "POST",
      headers: {
        Referer: "https://evil.example/page",
        "content-type": "application/json",
      },
      body,
    });
    expect(foreignReferer.status).toBe(403);

    expect(repoState.createInvitationCalls).toHaveLength(0);
  });

  it("allows same-origin browser mutations and non-browser clients", async () => {
    const body = JSON.stringify({
      email: "new@example.com",
      name: "New Person",
      role: "member",
      providerIds: [],
    });

    const sameOrigin = await invokeWorker("/api/admin/home/invitations", {
      method: "POST",
      headers: {
        Origin: "http://localhost:8787",
        "Sec-Fetch-Site": "same-origin",
        "content-type": "application/json",
      },
      body,
    });
    expect(sameOrigin.status).toBe(201);

    const curlLike = await invokeWorker("/api/admin/home/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(curlLike.status).toBe(201);
  });
});

describe("security headers", () => {
  it("sets CSP, frame, sniffing, referrer and HSTS headers on API and SPA responses", async () => {
    for (const path of ["/api/setup/status", "/", "/casa/inbox"]) {
      const response = await invokeWorker(path);
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("default-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("img-src 'self' data: https:");
      expect(csp, path).toContain("script-src 'self'");
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("x-content-type-options"), path).toBe(
        "nosniff",
      );
      expect(response.headers.get("referrer-policy"), path).toBe("no-referrer");
      expect(response.headers.get("strict-transport-security"), path).toContain(
        "max-age=",
      );
    }
  });
});
