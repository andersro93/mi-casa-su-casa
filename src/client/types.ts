export type SessionData = {
  user?: {
    email?: string | null;
    name?: string | null;
    role?: string | null;
  };
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

export type MemberFormState = {
  email: string;
  name: string;
  password: string;
  role: "member" | "admin";
};

export type ProviderMessagesResponse = {
  provider: {
    providerKey: string;
    displayName: string;
  };
  messages: InboxMessage[];
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
  setupSecret: string;
};
