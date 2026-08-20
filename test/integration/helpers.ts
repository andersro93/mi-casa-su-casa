import { env } from "cloudflare:test";

export const db: D1Database = env.DB;

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...(env as unknown as Env), ...overrides };
}

/**
 * Inserts a Better Auth `user` row directly. Use this for tests that need a
 * user to attach memberships to without going through sign-up.
 */
export async function createTestUser(input: {
  id?: string;
  email: string;
  name?: string;
  role?: string;
}) {
  const id = input.id ?? crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt)
       VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5)`,
    )
    .bind(id, input.name ?? input.email, input.email, input.role ?? "user", now)
    .run();

  return { id, email: input.email };
}

export async function insertHousehold(input: {
  id?: string;
  slug: string;
  displayName?: string;
}) {
  const id = input.id ?? crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO households (id, slug, display_name) VALUES (?1, ?2, ?3)`,
    )
    .bind(id, input.slug, input.displayName ?? input.slug)
    .run();

  return { id, slug: input.slug };
}

export async function insertMembership(input: {
  householdId: string;
  userId: string;
  role: "owner" | "member";
}) {
  await db
    .prepare(
      `INSERT INTO household_memberships (id, household_id, user_id, role)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(crypto.randomUUID(), input.householdId, input.userId, input.role)
    .run();
}

export async function tableColumns(table: string): Promise<string[]> {
  const result = await db
    .prepare(`PRAGMA table_info(${table})`)
    .all<{ name: string }>();
  return result.results.map((row) => row.name);
}

export async function count(table: string, where = "1=1", ...binds: unknown[]) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Tables in FK-safe deletion order (children first). */
const RESET_ORDER = [
  "messages",
  "quarantine_messages",
  "sender_rules",
  "household_member_provider_access",
  "household_invitation_provider_access",
  "household_invitations",
  "household_memberships",
  "providers",
  "households",
  "audit_events",
  "two_factor",
  "passkey",
  "session",
  "account",
  "verification",
  "user",
  "rate_limit",
];

/** Empties every application table so each test starts from a clean database. */
export async function resetDatabase() {
  await db.batch([
    ...RESET_ORDER.map((table) => db.prepare(`DELETE FROM ${table}`)),
    db.prepare(
      `UPDATE app_installation
       SET status = 'pending', owner_user_id = NULL, owner_email = NULL, completed_at = NULL
       WHERE id = 1`,
    ),
  ]);
}
