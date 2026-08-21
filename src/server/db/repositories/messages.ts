import { and, eq, sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import { unwrapDatabaseError } from "../errors";
import {
  messages as messagesTable,
  quarantineMessages as quarantineTable,
} from "../schema";
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

/**
 * received_at is always the server's clock. The sender-controlled Date:
 * header is stored separately for display only, so it can neither reorder
 * the inbox nor push delete_after past the retention window.
 */
function resolveReceivedAt(now: Date): string {
  return now.toISOString();
}

function normalizeDateHeader(dateHeader: string | null): string | null {
  if (!dateHeader) {
    return null;
  }

  const parsed = new Date(dateHeader);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isDuplicateMessageError(
  error: unknown,
  tableName: "messages" | "quarantine_messages",
): boolean {
  const databaseError = unwrapDatabaseError(error);

  return (
    databaseError instanceof Error &&
    databaseError.message.includes(
      `UNIQUE constraint failed: ${tableName}.household_id, ${tableName}.message_id`,
    )
  );
}

export async function insertMessage(
  db: D1Database,
  parsed: ParsedIncomingEmail,
  householdId: string,
  providerId: string,
  result: Extract<ClassificationResult, { kind: "matched" }>,
  now: Date = new Date(),
) {
  const database = dbForDatabase(db);
  const id = crypto.randomUUID();
  const receivedAt = resolveReceivedAt(now);
  const deleteAfter = addRetentionWindow(receivedAt);
  const dateHeader = normalizeDateHeader(parsed.dateHeader);

  try {
    await database.run(sql`
      INSERT INTO messages (
        id, household_id, message_id, provider_id, envelope_from, envelope_to, from_header, subject,
        text_body, extracted_code, classification_reason, raw_size, date_header, received_at, delete_after
      ) VALUES (
        ${id}, ${householdId}, ${parsed.messageId ?? id}, ${providerId}, ${parsed.envelopeFrom}, ${parsed.envelopeTo},
        ${parsed.fromHeader}, ${parsed.subject}, ${parsed.textBody}, ${result.code}, ${result.reason},
        ${parsed.rawSize}, ${dateHeader}, ${receivedAt}, ${deleteAfter}
      )
    `);
  } catch (error) {
    if (!isDuplicateMessageError(error, "messages")) {
      throw unwrapDatabaseError(error);
    }
  }

  return { id, receivedAt, deleteAfter };
}

export async function insertQuarantineMessage(
  db: D1Database,
  parsed: ParsedIncomingEmail,
  householdId: string,
  result: Extract<ClassificationResult, { kind: "quarantine" }>,
  now: Date = new Date(),
) {
  const database = dbForDatabase(db);
  const id = crypto.randomUUID();
  const receivedAt = resolveReceivedAt(now);
  const deleteAfter = addRetentionWindow(receivedAt);
  const dateHeader = normalizeDateHeader(parsed.dateHeader);

  try {
    await database.run(sql`
      INSERT INTO quarantine_messages (
        id, household_id, message_id, envelope_from, envelope_to, from_header, subject,
        text_body, extracted_code, quarantine_reason, raw_size, date_header, received_at, delete_after
      ) VALUES (
        ${id}, ${householdId}, ${parsed.messageId ?? id}, ${parsed.envelopeFrom}, ${parsed.envelopeTo},
        ${parsed.fromHeader}, ${parsed.subject}, ${parsed.textBody}, ${result.code}, ${result.reason},
        ${parsed.rawSize}, ${dateHeader}, ${receivedAt}, ${deleteAfter}
      )
    `);
  } catch (error) {
    if (!isDuplicateMessageError(error, "quarantine_messages")) {
      throw unwrapDatabaseError(error);
    }
  }

  return { id, receivedAt, deleteAfter };
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type PageOptions = {
  /** Maximum rows to return (1..MAX_PAGE_SIZE). */
  limit?: number;
  /** Only rows received strictly before this ISO timestamp (keyset cursor). */
  before?: string | null;
};

export type Page<T> = {
  items: T[];
  /** Cursor for the next (older) page, or null when this was the last page. */
  nextBefore: string | null;
};

export function normalizePageOptions(options: PageOptions = {}) {
  const requested = Number(options.limit ?? DEFAULT_PAGE_SIZE);
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)))
    : DEFAULT_PAGE_SIZE;
  const before =
    options.before && !Number.isNaN(Date.parse(options.before))
      ? new Date(options.before).toISOString()
      : null;
  return { limit, before };
}

function toPage<T extends { received_at: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextBefore: hasMore ? (items[items.length - 1]?.received_at ?? null) : null,
  };
}

export async function listMessagesForProvider(
  db: D1Database,
  householdId: string,
  providerKey: string,
  options: PageOptions = {},
): Promise<Page<InboxMessageRow>> {
  const { limit, before } = normalizePageOptions(options);
  // Fetch one extra row to know whether an older page exists.
  const result = await dbForDatabase(db).all<InboxMessageRow>(sql`
    SELECT messages.id, households.slug AS household_slug, providers.provider_key, providers.display_name AS provider_display_name,
            messages.subject, messages.from_header, messages.text_body,
            messages.extracted_code, messages.status, messages.received_at
    FROM messages
    INNER JOIN providers ON providers.id = messages.provider_id
    INNER JOIN households ON households.id = messages.household_id
    WHERE messages.household_id = ${householdId} AND providers.provider_key = ${providerKey}
      AND (${before} IS NULL OR messages.received_at < ${before})
    ORDER BY messages.received_at DESC, messages.id DESC
    LIMIT ${limit + 1}
  `);

  return toPage(result, limit);
}

export async function listProviderSummariesForUser(
  db: D1Database,
  householdId: string,
  userId: string,
): Promise<ProviderSummaryRow[]> {
  const result = await dbForDatabase(db).all<ProviderSummaryRow>(sql`
    SELECT households.slug AS household_slug,
            providers.provider_key,
            providers.display_name,
            CAST(COUNT(messages.id) AS INTEGER) AS message_count,
            CAST(COALESCE(SUM(CASE WHEN messages.status = 'new' THEN 1 ELSE 0 END), 0) AS INTEGER) AS new_count,
            MAX(messages.received_at) AS latest_received_at,
            latest.id AS latest_message_id,
            latest.subject AS latest_subject,
            latest.extracted_code AS latest_code,
            latest.status AS latest_status
    FROM providers
    INNER JOIN households ON households.id = providers.household_id
    INNER JOIN household_memberships
      ON household_memberships.household_id = providers.household_id
      AND household_memberships.user_id = ${userId}
    LEFT JOIN household_member_provider_access
      ON household_member_provider_access.household_membership_id = household_memberships.id
      AND household_member_provider_access.provider_id = providers.id
    LEFT JOIN messages
      ON messages.provider_id = providers.id
      AND messages.household_id = providers.household_id
    LEFT JOIN messages AS latest
      ON latest.id = (
        SELECT newest.id FROM messages AS newest
        WHERE newest.provider_id = providers.id AND newest.household_id = providers.household_id
        ORDER BY newest.received_at DESC, newest.id DESC
        LIMIT 1
      )
    WHERE providers.household_id = ${householdId}
      AND (household_memberships.role = 'owner' OR household_member_provider_access.id IS NOT NULL)
    GROUP BY households.slug, providers.id, providers.provider_key, providers.display_name, providers.created_at,
             latest.id, latest.subject, latest.extracted_code, latest.status
    ORDER BY COALESCE(MAX(messages.received_at), providers.created_at) DESC, providers.display_name ASC
  `);

  return result;
}

export async function countUnreviewedQuarantine(
  db: D1Database,
  householdId: string,
): Promise<number> {
  const row = await dbForDatabase(db).get<{ total: number }>(sql`
    SELECT COUNT(*) AS total
    FROM quarantine_messages
    WHERE household_id = ${householdId} AND reviewed_at IS NULL
  `);
  return Number(row?.total ?? 0);
}

export async function listQuarantineMessages(
  db: D1Database,
  householdId: string,
  options: PageOptions = {},
): Promise<Page<QuarantineMessageRow>> {
  const { limit, before } = normalizePageOptions(options);
  const result = await dbForDatabase(db).all<QuarantineMessageRow>(sql`
    SELECT quarantine_messages.id,
            households.slug AS household_slug,
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
    INNER JOIN households ON households.id = quarantine_messages.household_id
    WHERE quarantine_messages.household_id = ${householdId} AND reviewed_at IS NULL
      AND (${before} IS NULL OR received_at < ${before})
    ORDER BY received_at DESC, quarantine_messages.id DESC
    LIMIT ${limit + 1}
  `);

  return toPage(result, limit);
}

export async function updateMessageStatus(
  db: D1Database,
  householdId: string,
  messageId: string,
  status: MessageStatus,
): Promise<InboxMessageRow | null> {
  await dbForDatabase(db).run(sql`
    UPDATE messages SET status = ${status} WHERE household_id = ${householdId} AND id = ${messageId}
  `);

  return findMessageById(db, householdId, messageId);
}

export async function findMessageById(
  db: D1Database,
  householdId: string,
  messageId: string,
): Promise<InboxMessageRow | null> {
  return dbForDatabase(db).get<InboxMessageRow>(sql`
    SELECT messages.id, households.slug AS household_slug, providers.provider_key, providers.display_name AS provider_display_name,
            messages.subject, messages.from_header, messages.text_body,
            messages.extracted_code, messages.status, messages.received_at
    FROM messages
    INNER JOIN providers ON providers.id = messages.provider_id
    INNER JOIN households ON households.id = messages.household_id
    WHERE messages.household_id = ${householdId} AND messages.id = ${messageId}
    LIMIT 1
  `);
}

type QuarantineMessageRecord = {
  id: string;
  household_id: string;
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
  date_header: string | null;
  reviewed_at: string | null;
};

async function findQuarantineMessageRecord(
  db: D1Database,
  householdId: string,
  messageId: string,
): Promise<QuarantineMessageRecord | null> {
  return dbForDatabase(db).get<QuarantineMessageRecord>(sql`
    SELECT id, household_id, message_id, envelope_from, envelope_to, from_header, subject,
            text_body, extracted_code, quarantine_reason, raw_size,
            received_at, delete_after, date_header, reviewed_at
    FROM quarantine_messages
    WHERE household_id = ${householdId} AND id = ${messageId}
    LIMIT 1
  `);
}

export async function reviewQuarantineMessage(
  db: D1Database,
  householdId: string,
  messageId: string,
  review: { action: "dismiss" | "release"; providerId?: string },
): Promise<{
  reviewedAt: string;
  releasedMessage: InboxMessageRow | null;
} | null> {
  const record = await findQuarantineMessageRecord(db, householdId, messageId);
  const database = dbForDatabase(db);

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

    // Insert the released copy and mark the quarantine row reviewed in one
    // atomic batch. If a message with the same Message-ID already exists in
    // this household (e.g. a duplicate delivery that was classified after a
    // rule change), keep the existing row instead of failing.
    await database.batch([
      database
        .insert(messagesTable)
        .values({
          id: crypto.randomUUID(),
          householdId: record.household_id,
          messageId: record.message_id,
          providerId: review.providerId,
          envelopeFrom: record.envelope_from,
          envelopeTo: record.envelope_to,
          fromHeader: record.from_header,
          subject: record.subject,
          textBody: record.text_body,
          extractedCode: record.extracted_code,
          status: "new",
          classificationReason: `Released from quarantine by owner review. Original reason: ${record.quarantine_reason}`,
          rawSize: record.raw_size,
          dateHeader: record.date_header,
          receivedAt: record.received_at,
          deleteAfter: record.delete_after,
        })
        .onConflictDoNothing(),
      database
        .update(quarantineTable)
        .set({ reviewedAt })
        .where(
          and(
            eq(quarantineTable.householdId, householdId),
            eq(quarantineTable.id, messageId),
          ),
        ),
    ]);

    const result = await database.get<InboxMessageRow>(sql`
      SELECT messages.id, households.slug AS household_slug, providers.provider_key, providers.display_name AS provider_display_name,
              messages.subject, messages.from_header, messages.text_body,
              messages.extracted_code, messages.status, messages.received_at
      FROM messages
      INNER JOIN providers ON providers.id = messages.provider_id
      INNER JOIN households ON households.id = messages.household_id
      WHERE messages.household_id = ${record.household_id} AND messages.message_id = ${record.message_id}
      ORDER BY messages.created_at DESC
      LIMIT 1
    `);

    releasedMessage = result ?? null;
    return { reviewedAt, releasedMessage };
  }

  await database.run(sql`
    UPDATE quarantine_messages SET reviewed_at = ${reviewedAt} WHERE household_id = ${householdId} AND id = ${messageId}
  `);

  return { reviewedAt, releasedMessage };
}

export const PURGE_BATCH_SIZE = 500;

export type PurgeResult = {
  messages: number;
  quarantine: number;
  batches: number;
};

async function purgeTableInBatches(
  db: D1Database,
  table: "messages" | "quarantine_messages",
  nowIso: string,
  batchSize: number,
): Promise<{ deleted: number; batches: number }> {
  let deleted = 0;
  let batches = 0;

  // Bounded deletes keep each statement well inside D1 limits even after a
  // long cron outage; loop until a batch comes back short.
  while (true) {
    const result = await db
      .prepare(
        `DELETE FROM ${table}
         WHERE rowid IN (
           SELECT rowid FROM ${table} WHERE delete_after <= ?1 LIMIT ?2
         )`,
      )
      .bind(nowIso, batchSize)
      .run();
    const changes = Number(result.meta.changes ?? 0);
    deleted += changes;
    batches += 1;
    if (changes < batchSize) {
      break;
    }
  }

  return { deleted, batches };
}

export async function purgeExpired(
  db: D1Database,
  nowIso: string,
  batchSize: number = PURGE_BATCH_SIZE,
): Promise<PurgeResult> {
  const messages = await purgeTableInBatches(db, "messages", nowIso, batchSize);
  const quarantine = await purgeTableInBatches(
    db,
    "quarantine_messages",
    nowIso,
    batchSize,
  );

  return {
    messages: messages.deleted,
    quarantine: quarantine.deleted,
    batches: messages.batches + quarantine.batches,
  };
}
