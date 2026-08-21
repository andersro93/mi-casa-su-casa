export type SessionData = {
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    role?: string | null;
  };
  session?: {
    id?: string;
  };
};

export type HouseholdSummary = {
  id: string;
  slug: string;
  displayName: string;
  role: "owner" | "member";
};

export type ProviderSummary = {
  provider_key: string;
  display_name: string;
  message_count: number;
  new_count: number;
  latest_received_at: string | null;
};

export type InboxMessage = {
  id: string;
  provider_key: string;
  provider_display_name: string;
  subject: string | null;
  from_header: string | null;
  text_body: string;
  extracted_code: string | null;
  status: "new" | "used" | "expired";
  received_at: string;
};

export type QuarantineMessage = {
  id: string;
  provider_key: "quarantine";
  provider_display_name: "Quarantine";
  subject: string | null;
  from_header: string | null;
  envelope_from: string;
  text_body: string;
  extracted_code: string | null;
  status: "new";
  quarantine_reason: string;
  received_at: string;
};

export type MemberSummary = {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  providerAccess: Array<{
    providerKey: string;
    displayName: string;
  }>;
};

export type ProviderOption = {
  id: string;
  provider_key: string;
  display_name: string;
};

export type ProviderConfiguration = {
  id: string;
  provider_key: string;
  display_name: string;
  created_at: string;
  rule_count: number;
};

export type SenderRule = {
  id: string;
  provider_id: string;
  match_type: "exact" | "domain";
  match_value: string;
  created_at: string;
};

export type ProviderConfigurationResponse = {
  providers: ProviderConfiguration[];
  rules: SenderRule[];
};

export type ProviderFormState = {
  providerKey: string;
  displayName: string;
};

export type SenderRuleFormState = {
  providerId: string;
  matchType: "exact" | "domain";
  matchValue: string;
};

export type MemberFormState = {
  email: string;
  name: string;
  role: "member" | "owner";
};

export type InvitationFormState = {
  email: string;
  name: string;
  role: "member" | "owner";
  providerIds: string[];
};

export type InvitationSummary = {
  id: string;
  email: string;
  name: string;
  role: "member" | "owner";
  status: "pending" | "accepted" | "cancelled" | "expired";
  invitedByUserId: string;
  acceptedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  providers: ProviderOption[];
};

export type AccountSession = {
  id: string;
  isCurrent: boolean;
  expiresAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  impersonatedBy: string | null;
};

export type AccountProfile = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string | null;
  twoFactorEnabled: boolean;
  households: HouseholdSummary[];
};

export type AccountSettingsResponse = {
  profile: AccountProfile;
  sessions: AccountSession[];
};

export type AccountSettingsFormState = {
  name: string;
  image: string;
  currentPassword: string;
  newPassword: string;
  forgotPasswordEmail: string;
  twoFactorPassword: string;
  twoFactorCode: string;
  twoFactorBackupCode: string;
  passkeyName: string;
};

export type HouseholdSettings = {
  slug: string;
  /** <slug>@EMAIL_DOMAIN, or null until the operator configures EMAIL_DOMAIN. */
  emailAddress: string | null;
  displayName: string;
};

export type HouseholdSettingsResponse = {
  household: HouseholdSettings;
};

export type HouseholdSettingsFormState = {
  displayName: string;
};

export type InvitationAcceptanceState = {
  name: string;
  password: string;
};

export type PageInfo = {
  limit: number;
  /** Cursor for older items, null when everything has been loaded. */
  nextBefore: string | null;
};

export type ProviderMessagesResponse = {
  provider: {
    providerKey: string;
    displayName: string;
  };
  messages: InboxMessage[];
  page: PageInfo;
};

export type QuarantineMessagesResponse = {
  messages: QuarantineMessage[];
  page: PageInfo;
};

export type LoginState = {
  email: string;
  password: string;
};

export type SetupStatus = {
  needsSetup: boolean;
  setupLocked: boolean;
  isConfigured: boolean;
  status: "pending" | "in_progress" | "complete";
};

export type SetupFormState = {
  email: string;
  name: string;
  password: string;
  householdName: string;
  householdSlug: string;
  setupSecret: string;
};

export type CreateHouseholdFormState = {
  displayName: string;
  slug: string;
};

export type InvitationDeliveryResponse = {
  invitation: InvitationSummary;
  inviteUrl: string;
  emailSent: boolean;
  emailError?: string;
};

export type InvitationLookupResponse = {
  invitation: InvitationSummary;
  accountExists: boolean;
  viewer: { email: string; emailMatches: boolean } | null;
};

export type TwoFactorSetup = {
  totpURI: string;
  qrDataUrl: string | null;
  secret: string | null;
  backupCodes: string[];
};

/** Whether the app can be installed to the home screen from this browser. */
export type InstallStatus = "installed" | "available" | "manual";

export interface InstallState {
  status: InstallStatus;
  /** Opens the browser's install prompt; no-op unless status is "available". */
  onInstall: () => void | Promise<void>;
}
