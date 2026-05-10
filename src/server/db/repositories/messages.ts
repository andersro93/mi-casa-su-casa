import type {
  ClassificationResult,
  InboxMessageRow,
  MessageStatus,
  ParsedIncomingEmail,
  ProviderSummaryRow,
  QuarantineMessageRow,
} from "../types";

const RETENTION_DAYS = 30;

function addRetentionWindow(isoDate: string): string {
  const next = new Date(isoDate);
  next.setUTCDate(next.getUTCDate() + RETENTION_DAYS);
  return next.toISOString();
}

function resolveReceivedAt(dateHeader: string | null): string {
  if (!dateHeader) {
    return new Date().toISOString();
  }

  const receivedAt = new Date(dateHeader);

  if (Number.isNaN(receivedAt.getTime())) {
    return new Date().toISOString();
  }

  return receivedAt.toISOString();
}

function isDuplicateMessageError(
  error: unknown,
  tableName: "messages" | "quarantine_messages",
): boolean {
  return (
    error instanceof Error &&
    error.message.includes(`UNIQUE constraint failed: ${tableName}.message_id`)
  );
}

export async function insertMessage(
  db: D1Database,
  parsed: ParsedIncomingEmail,
  providerId: string,
  result: Extract<ClassificationResult, { kind: "matched" }>,
) {
  const id = crypto.randomUUID();
  const receivedAt = resolveReceivedAt(parsed.dateHeader);
  const deleteAfter = addRetentionWindow(receivedAt);

  try {
    await db
      .prepare(
        `INSERT INTO messages (
          id, message_id, provider_id, envelope_from, envelope_to, from_header, subject,
          text_body, extracted_code, classification_reason, raw_size, received_at, delete_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        parsed.messageId ?? id,
        providerId,
        parsed.envelopeFrom,
        parsed.envelopeTo,
        parsed.fromHeader,
        parsed.subject,
        parsed.textBody,
        result.code,
        result.reason,
        parsed.rawSize,
        receivedAt,
        deleteAfter,
      )
      .run();
  } catch (error) {
    if (!isDuplicateMessageError(error, "messages")) {
      throw error;
    }
  }

  return { id, receivedAt, deleteAfter };
}

export async function insertQuarantineMessage(
  db: D1Database,
  parsed: ParsedIncomingEmail,
  result: Extract<ClassificationResult, { kind: "quarantine" }>,
) {
  const id = crypto.randomUUID();
  const receivedAt = resolveReceivedAt(parsed.dateHeader);
  const deleteAfter = addRetentionWindow(receivedAt);

  try {
    await db
      .prepare(
        `INSERT INTO quarantine_messages (
          id, message_id, envelope_from, envelope_to, from_header, subject,
          text_body, extracted_code, quarantine_reason, raw_size, received_at, delete_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        parsed.messageId ?? id,
        parsed.envelopeFrom,
        parsed.envelopeTo,
        parsed.fromHeader,
        parsed.subject,
        parsed.textBody,
        result.code,
        result.reason,
        parsed.rawSize,
        receivedAt,
        deleteAfter,
      )
      .run();
  } catch (error) {
    if (!isDuplicateMessageError(error, "quarantine_messages")) {
      throw error;
    }
  }

  return { id, receivedAt, deleteAfter };
}

export async function listMessagesForProvider(
  db: D1Database,
  providerKey: string,
): Promise<InboxMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT messages.id, providers.provider_key, providers.display_name AS provider_display_name,
              messages.subject, messages.from_header, messages.text_body,
              messages.extracted_code, messages.status, messages.received_at
       FROM messages
       INNER JOIN providers ON providers.id = messages.provider_id
       WHERE providers.provider_key = ?
        ORDER BY messages.received_at DESC`,
    )
    .bind(providerKey)
    .run<InboxMessageRow>();

  return result.results ?? [];
}

export async function listProviderSummariesForUser(
  db: D1Database,
  userId: string,
  role: string,
): Promise<ProviderSummaryRow[]> {
  const result = await db
    .prepare(
      `SELECT providers.provider_key,
              providers.display_name,
              CAST(COUNT(messages.id) AS INTEGER) AS message_count,
              CAST(COALESCE(SUM(CASE WHEN messages.status = 'new' THEN 1 ELSE 0 END), 0) AS INTEGER) AS new_count,
              MAX(messages.received_at) AS latest_received_at
       FROM providers
       LEFT JOIN user_provider_access
         ON user_provider_access.provider_id = providers.id AND user_provider_access.user_id = ?
       LEFT JOIN messages ON messages.provider_id = providers.id
       WHERE ? = 'admin' OR user_provider_access.user_id IS NOT NULL
       GROUP BY providers.id, providers.provider_key, providers.display_name, providers.created_at
       ORDER BY COALESCE(MAX(messages.received_at), providers.created_at) DESC, providers.display_name ASC`,
    )
    .bind(userId, role)
    .run<ProviderSummaryRow>();

  return result.results ?? [];
}

export async function listQuarantineMessages(
  db: D1Database,
): Promise<QuarantineMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT id,
              'quarantine' AS provider_key,
              'Quarantine' AS provider_display_name,
              subject,
              from_header,
              envelope_from,
              text_body,
              extracted_code,
              'new' AS status,
              quarantine_reason,
              received_at
       FROM quarantine_messages
       WHERE reviewed_at IS NULL
        ORDER BY received_at DESC`,
    )
    .run<QuarantineMessageRow>();

  return result.results ?? [];
}

export async function updateMessageStatus(
  db: D1Database,
  messageId: string,
  status: MessageStatus,
): Promise<InboxMessageRow | null> {
  await db
    .prepare("UPDATE messages SET status = ? WHERE id = ?")
    .bind(status, messageId)
    .run();

  return db
    .prepare(
      `SELECT messages.id, providers.provider_key, providers.display_name AS provider_display_name,
              messages.subject, messages.from_header, messages.text_body,
              messages.extracted_code, messages.status, messages.received_at
       FROM messages
       INNER JOIN providers ON providers.id = messages.provider_id
       WHERE messages.id = ?
       LIMIT 1`,
    )
    .bind(messageId)
    .first<InboxMessageRow>();
}

export async function findMessageById(
  db: D1Database,
  messageId: string,
): Promise<InboxMessageRow | null> {
  return db
    .prepare(
      `SELECT messages.id, providers.provider_key, providers.display_name AS provider_display_name,
              messages.subject, messages.from_header, messages.text_body,
              messages.extracted_code, messages.status, messages.received_at
       FROM messages
       INNER JOIN providers ON providers.id = messages.provider_id
       WHERE messages.id = ?
       LIMIT 1`,
    )
    .bind(messageId)
    .first<InboxMessageRow>();
}

type QuarantineMessageRecord = {
  id: string;
  message_id: string;
  envelope_from: string;
  envelope_to: string;
  from_header: string | null;
  subject: string | null;
  text_body: string;
  extracted_code: string | null;
  quarantine_reason: string;
  raw_size: number;
  received_at: string;
  delete_after: string;
  reviewed_at: string | null;
};

async function findQuarantineMessageRecord(
  db: D1Database,
  messageId: string,
): Promise<QuarantineMessageRecord | null> {
  return db
    .prepare(
      `SELECT id, message_id, envelope_from, envelope_to, from_header, subject,
              text_body, extracted_code, quarantine_reason, raw_size,
              received_at, delete_after, reviewed_at
       FROM quarantine_messages
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(messageId)
    .first<QuarantineMessageRecord>();
}

export async function reviewQuarantineMessage(
  db: D1Database,
  messageId: string,
  review: { action: "dismiss" | "release"; providerId?: string },
): Promise<{
  reviewedAt: string;
  releasedMessage: InboxMessageRow | null;
} | null> {
  const record = await findQuarantineMessageRecord(db, messageId);

  if (!record || record.reviewed_at) {
    return null;
  }

  const reviewedAt = new Date().toISOString();
  let releasedMessage: InboxMessageRow | null = null;

  if (review.action === "release") {
    if (!review.providerId) {
      throw new Error(
        "Provider id is required to release a quarantined message.",
      );
    }

    await db
      .prepare(
        `INSERT INTO messages (
          id, message_id, provider_id, envelope_from, envelope_to, from_header, subject,
          text_body, extracted_code, status, classification_reason, raw_size, received_at, delete_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        record.message_id,
        review.providerId,
        record.envelope_from,
        record.envelope_to,
        record.from_header,
        record.subject,
        record.text_body,
        record.extracted_code,
        "new",
        `Released from quarantine by owner review. Original reason: ${record.quarantine_reason}`,
        record.raw_size,
        record.received_at,
        record.delete_after,
      )
      .run();

    const result = await db
      .prepare(
        `SELECT messages.id, providers.provider_key, providers.display_name AS provider_display_name,
                messages.subject, messages.from_header, messages.text_body,
                messages.extracted_code, messages.status, messages.received_at
         FROM messages
         INNER JOIN providers ON providers.id = messages.provider_id
         WHERE messages.message_id = ?
         ORDER BY messages.created_at DESC
         LIMIT 1`,
      )
      .bind(record.message_id)
      .first<InboxMessageRow>();

    releasedMessage = result ?? null;
  }

  await db
    .prepare("UPDATE quarantine_messages SET reviewed_at = ? WHERE id = ?")
    .bind(reviewedAt, messageId)
    .run();

  return { reviewedAt, releasedMessage };
}

export async function purgeExpired(db: D1Database, nowIso: string) {
  await db.batch([
    db.prepare("DELETE FROM messages WHERE delete_after <= ?").bind(nowIso),
    db
      .prepare("DELETE FROM quarantine_messages WHERE delete_after <= ?")
      .bind(nowIso),
  ]);
}
