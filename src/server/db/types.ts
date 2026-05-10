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
  subject: string | null;
  text_body: string;
  extracted_code: string | null;
  status: "new" | "used" | "expired";
  received_at: string;
};
