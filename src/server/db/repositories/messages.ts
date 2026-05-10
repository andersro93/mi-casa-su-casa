import type {
  ClassificationResult,
  InboxMessageRow,
  ParsedIncomingEmail,
} from "../types";

const RETENTION_DAYS = 30;

function addRetentionWindow(isoDate: string): string {
  const next = new Date(isoDate);
  next.setUTCDate(next.getUTCDate() + RETENTION_DAYS);
  return next.toISOString();
}

export async function insertMessage(
  db: D1Database,
  parsed: ParsedIncomingEmail,
  providerId: string,
  result: Extract<ClassificationResult, { kind: "matched" }>,
) {
  const id = crypto.randomUUID();
  const receivedAt = parsed.dateHeader
    ? new Date(parsed.dateHeader).toISOString()
    : new Date().toISOString();
  const deleteAfter = addRetentionWindow(receivedAt);

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

  return { id, receivedAt, deleteAfter };
}

export async function insertQuarantineMessage(
  db: D1Database,
  parsed: ParsedIncomingEmail,
  result: Extract<ClassificationResult, { kind: "quarantine" }>,
) {
  const id = crypto.randomUUID();
  const receivedAt = parsed.dateHeader
    ? new Date(parsed.dateHeader).toISOString()
    : new Date().toISOString();
  const deleteAfter = addRetentionWindow(receivedAt);

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

  return { id, receivedAt, deleteAfter };
}

export async function listMessagesForProvider(
  db: D1Database,
  providerKey: string,
): Promise<InboxMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT messages.id, providers.provider_key, messages.subject, messages.text_body,
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

export async function listQuarantineMessages(
  db: D1Database,
): Promise<InboxMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT id, 'quarantine' AS provider_key, subject, text_body, extracted_code,
              'new' AS status, received_at
       FROM quarantine_messages
       WHERE reviewed_at IS NULL
       ORDER BY received_at DESC`,
    )
    .run<InboxMessageRow>();

  return result.results ?? [];
}

export async function purgeExpired(db: D1Database, nowIso: string) {
  await db.batch([
    db.prepare("DELETE FROM messages WHERE delete_after <= ?").bind(nowIso),
    db
      .prepare("DELETE FROM quarantine_messages WHERE delete_after <= ?")
      .bind(nowIso),
  ]);
}
