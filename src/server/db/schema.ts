import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  role: text("role").default("user"),
  twoFactorEnabled: integer("twoFactorEnabled", { mode: "boolean" })
    .default(false)
    .notNull(),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("banReason"),
  banExpires: integer("banExpires", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonatedBy"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: integer("verified", { mode: "boolean" }).default(true),
  },
  (table) => [
    index("twoFactor_secret_idx").on(table.secret),
    index("twoFactor_userId_idx").on(table.userId),
  ],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_userId_idx").on(table.userId),
    index("passkey_credentialID_idx").on(table.credentialID),
  ],
);

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("providers_household_id_provider_key_unique").on(
      table.householdId,
      table.providerKey,
    ),
    index("providers_household_id_idx").on(table.householdId),
  ],
);

export const households = sqliteTable(
  "households",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("households_slug_idx").on(table.slug)],
);

export const householdMemberships = sqliteTable(
  "household_memberships",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "member">().notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("household_memberships_household_user_unique").on(
      table.householdId,
      table.userId,
    ),
    index("household_memberships_household_id_idx").on(table.householdId),
    index("household_memberships_user_id_idx").on(table.userId),
    check(
      "household_memberships_role_check",
      sql`${table.role} in ('owner', 'member')`,
    ),
  ],
);

export const householdMemberProviderAccess = sqliteTable(
  "household_member_provider_access",
  {
    id: text("id").primaryKey(),
    householdMembershipId: text("household_membership_id")
      .notNull()
      .references(() => householdMemberships.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex(
      "household_member_provider_access_membership_provider_unique",
    ).on(table.householdMembershipId, table.providerId),
    index("household_member_provider_access_membership_idx").on(
      table.householdMembershipId,
    ),
    index("household_member_provider_access_provider_idx").on(table.providerId),
  ],
);

export const senderRules = sqliteTable(
  "sender_rules",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    matchType: text("match_type").$type<"exact" | "domain">().notNull(),
    matchValue: text("match_value").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("sender_rules_household_match_type_match_value_unique").on(
      table.householdId,
      table.matchType,
      table.matchValue,
    ),
    index("idx_sender_rules_lookup").on(
      table.householdId,
      table.matchType,
      table.matchValue,
    ),
    check(
      "sender_rules_match_type_check",
      sql`${table.matchType} in ('exact', 'domain')`,
    ),
  ],
);

export const userProviderAccess = sqliteTable(
  "user_provider_access",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("user_provider_access_user_id_provider_id_unique").on(
      table.userId,
      table.providerId,
    ),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull().unique(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    envelopeFrom: text("envelope_from").notNull(),
    envelopeTo: text("envelope_to").notNull(),
    fromHeader: text("from_header"),
    subject: text("subject"),
    textBody: text("text_body").notNull(),
    extractedCode: text("extracted_code"),
    status: text("status").$type<"new" | "used" | "expired">().notNull(),
    classificationReason: text("classification_reason").notNull(),
    rawSize: integer("raw_size").notNull(),
    receivedAt: text("received_at").notNull(),
    deleteAfter: text("delete_after").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("messages_household_id_message_id_unique").on(
      table.householdId,
      table.messageId,
    ),
    index("idx_messages_provider_received").on(
      table.householdId,
      table.providerId,
      table.receivedAt,
    ),
    index("idx_messages_household_received").on(
      table.householdId,
      table.receivedAt,
    ),
    index("idx_messages_delete_after").on(table.deleteAfter),
    check(
      "messages_status_check",
      sql`${table.status} in ('new', 'used', 'expired')`,
    ),
  ],
);

export const quarantineMessages = sqliteTable(
  "quarantine_messages",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    envelopeFrom: text("envelope_from").notNull(),
    envelopeTo: text("envelope_to").notNull(),
    fromHeader: text("from_header"),
    subject: text("subject"),
    textBody: text("text_body").notNull(),
    extractedCode: text("extracted_code"),
    quarantineReason: text("quarantine_reason").notNull(),
    rawSize: integer("raw_size").notNull(),
    receivedAt: text("received_at").notNull(),
    deleteAfter: text("delete_after").notNull(),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("quarantine_messages_household_id_message_id_unique").on(
      table.householdId,
      table.messageId,
    ),
    index("idx_quarantine_household_received").on(
      table.householdId,
      table.receivedAt,
    ),
    index("idx_quarantine_delete_after").on(table.deleteAfter),
  ],
);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  detailsJson: text("details_json"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const appInstallation = sqliteTable(
  "app_installation",
  {
    id: integer("id").primaryKey(),
    status: text("status")
      .$type<"pending" | "in_progress" | "complete">()
      .notNull(),
    ownerUserId: text("owner_user_id"),
    ownerEmail: text("owner_email"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    check("app_installation_singleton_check", sql`${table.id} = 1`),
    check(
      "app_installation_status_check",
      sql`${table.status} in ('pending', 'in_progress', 'complete')`,
    ),
  ],
);

export const householdInvitations = sqliteTable(
  "household_invitations",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").$type<"member" | "owner">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status")
      .$type<"pending" | "accepted" | "cancelled" | "expired">()
      .notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: text("expires_at").notNull(),
    acceptedAt: text("accepted_at"),
    cancelledAt: text("cancelled_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_household_invitations_household_id").on(table.householdId),
    index("idx_household_invitations_email").on(table.email),
    index("idx_household_invitations_status").on(table.status),
    index("idx_household_invitations_expires_at").on(table.expiresAt),
    check(
      "household_invitations_role_check",
      sql`${table.role} in ('member', 'owner')`,
    ),
    check(
      "household_invitations_status_check",
      sql`${table.status} in ('pending', 'accepted', 'cancelled', 'expired')`,
    ),
  ],
);

export const householdInvitationProviderAccess = sqliteTable(
  "household_invitation_provider_access",
  {
    id: text("id").primaryKey(),
    invitationId: text("invitation_id")
      .notNull()
      .references(() => householdInvitations.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex(
      "household_invitation_provider_access_invitation_provider_unique",
    ).on(table.invitationId, table.providerId),
  ],
);
