export type ClassificationResult =
  | {
      kind: "matched";
      householdId: string;
      householdSlug: string;
      providerId: string;
      providerKey: string;
      code: string | null;
      reason: string;
    }
  | {
      kind: "quarantine";
      /** Resolved household, or null when the recipient is unknown. */
      householdId: string | null;
      reason: string;
      code: string | null;
    };

export type SenderAuthentication = {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
};

export type ParsedIncomingEmail = {
  envelopeFrom: string;
  envelopeTo: string;
  householdSlug: string | null;
  fromHeader: string | null;
  /** Lower-cased address from the RFC 5322 From: header, if parseable. */
  fromAddress?: string | null;
  /** Results from the Authentication-Results header(s), if present. */
  authentication?: SenderAuthentication | null;
  subject: string | null;
  messageId: string | null;
  dateHeader: string | null;
  textBody: string;
  /** True when textBody was cut to MAX_TEXT_BODY_CHARS. */
  textBodyTruncated?: boolean;
  rawSize: number;
};

export type InboxMessageRow = {
  id: string;
  household_slug: string;
  provider_key: string;
  provider_display_name: string;
  subject: string | null;
  from_header: string | null;
  text_body: string;
  extracted_code: string | null;
  status: "new" | "used" | "expired";
  received_at: string;
};

export type ProviderSummaryRow = {
  household_slug: string;
  provider_key: string;
  display_name: string;
  message_count: number;
  new_count: number;
  latest_received_at: string | null;
};

export type QuarantineMessageRow = {
  id: string;
  household_slug: string;
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

export type ProviderRow = {
  id: string;
  household_id?: string;
  provider_key: string;
  display_name: string;
  created_at?: string;
};

export type ProviderConfigurationRow = {
  id: string;
  household_id: string;
  provider_key: string;
  display_name: string;
  created_at: string;
  rule_count: number;
};

export type SenderRuleRow = {
  id: string;
  household_id: string;
  provider_id: string;
  match_type: "exact" | "domain";
  match_value: string;
  created_at: string;
};

export type MessageStatus = InboxMessageRow["status"];

export type MemberRecord = {
  id: string;
  householdRole: "owner" | "member";
  email: string;
  name: string;
  role: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemberAccessRow = {
  id: string;
  household_role: "owner" | "member";
  email: string;
  name: string;
  role: string | null;
  provider_key: string | null;
  provider_display_name: string | null;
};

export type HouseholdSummaryRow = {
  id: string;
  slug: string;
  displayName: string;
  role: "owner" | "member";
};

export type InstallationStateRow = {
  id: number;
  status: "pending" | "in_progress" | "complete";
  owner_user_id: string | null;
  owner_email: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
