import type { InstallationStateRow } from "../types";

const INSTALLATION_SEED_SQL = `
  INSERT INTO app_installation (id, status)
  VALUES (1, 'pending')
  ON CONFLICT(id) DO NOTHING
`;

export async function ensureInstallationState(db: D1Database) {
  await db.prepare(INSTALLATION_SEED_SQL).run();
}

export async function getInstallationState(
  db: D1Database,
): Promise<InstallationStateRow> {
  await ensureInstallationState(db);

  const row = await db
    .prepare(
      `SELECT id, status, owner_user_id, owner_email, completed_at, created_at, updated_at
       FROM app_installation
       WHERE id = 1
       LIMIT 1`,
    )
    .first<InstallationStateRow>();

  if (!row) {
    throw new Error("Installation state is unavailable");
  }

  return row;
}

export async function beginInstallationSetup(db: D1Database) {
  await ensureInstallationState(db);

  const result = await db
    .prepare(
      `UPDATE app_installation
       SET status = 'in_progress',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND status = 'pending'`,
    )
    .run();

  return Number(result.meta.changes ?? 0) > 0;
}

export async function completeInstallationSetup(
  db: D1Database,
  ownerUserId: string,
  ownerEmail: string,
) {
  await db
    .prepare(
      `UPDATE app_installation
       SET status = 'complete',
           owner_user_id = ?,
           owner_email = ?,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
    )
    .bind(ownerUserId, ownerEmail.toLowerCase())
    .run();
}

export async function resetInstallationSetup(db: D1Database) {
  await db
    .prepare(
      `UPDATE app_installation
       SET status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND status = 'in_progress' AND owner_user_id IS NULL`,
    )
    .run();
}
