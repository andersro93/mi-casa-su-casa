export type ClassificationResult =
  | {
      kind: "matched";
      providerId: string;
      providerKey: string;
      code: string | null;
      reason: string;
    }
  | {
      kind: "quarantine";
      reason: string;
      code: string | null;
    };

export type ParsedIncomingEmail = {
  envelopeFrom: string;
  envelopeTo: string;
  fromHeader: string | null;
  subject: string | null;
  messageId: string | null;
  dateHeader: string | null;
  textBody: string;
  rawSize: number;
};

export type InboxMessageRow = {
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

export type ProviderSummaryRow = {
  provider_key: string;
  display_name: string;
  message_count: number;
  new_count: number;
  latest_received_at: string | null;
};

export type QuarantineMessageRow = {
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

export type ProviderRow = {
  id: string;
  provider_key: string;
  display_name: string;
};

export type MessageStatus = InboxMessageRow["status"];

export type MemberRecord = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemberAccessRow = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  provider_key: string | null;
  provider_display_name: string | null;
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
