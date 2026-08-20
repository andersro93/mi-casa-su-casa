import { sql } from "drizzle-orm";

import { dbForDatabase } from "../client";
import type { InstallationStateRow } from "../types";

const INSTALLATION_SEED_SQL = `
  INSERT INTO app_installation (id, status)
  VALUES (1, 'pending')
  ON CONFLICT(id) DO NOTHING
`;

export async function ensureInstallationState(db: D1Database) {
  await dbForDatabase(db).run(sql.raw(INSTALLATION_SEED_SQL));
}

export async function getInstallationState(
  db: D1Database,
): Promise<InstallationStateRow> {
  await ensureInstallationState(db);

  const row = await dbForDatabase(db).get<InstallationStateRow>(sql`
    SELECT id, status, owner_user_id, owner_email, completed_at, created_at, updated_at
    FROM app_installation
    WHERE id = 1
    LIMIT 1
  `);

  if (!row) {
    throw new Error("Installation state is unavailable");
  }

  return row;
}

/**
 * An in-progress claim older than this is considered abandoned (the isolate
 * died mid-setup) and may be reclaimed by a new attempt.
 */
export const SETUP_CLAIM_TIMEOUT_MINUTES = 10;

export async function beginInstallationSetup(db: D1Database) {
  await ensureInstallationState(db);

  const staleBefore = `-${SETUP_CLAIM_TIMEOUT_MINUTES} minutes`;
  const result = await dbForDatabase(db).run(sql`
    UPDATE app_installation
    SET status = 'in_progress',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
      AND (
        status = 'pending'
        OR (status = 'in_progress' AND updated_at < datetime('now', ${staleBefore}))
      )
  `);

  return Number(result.meta.changes ?? 0) > 0;
}

export async function completeInstallationSetup(
  db: D1Database,
  ownerUserId: string,
  ownerEmail: string,
) {
  await dbForDatabase(db).run(sql`
    UPDATE app_installation
    SET status = 'complete',
        owner_user_id = ${ownerUserId},
        owner_email = ${ownerEmail.toLowerCase()},
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `);
}

export async function resetInstallationSetup(db: D1Database) {
  await dbForDatabase(db).run(sql`
    UPDATE app_installation
    SET status = 'pending',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND status = 'in_progress' AND owner_user_id IS NULL
  `);
}
