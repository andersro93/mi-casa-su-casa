# Operator runbook

Procedures for the things that go wrong at 2 a.m. Everything below uses the
Wrangler CLI authenticated against your Cloudflare account (`wrangler login`)
and assumes the production Worker is `mi-casa-su-casa` with D1 database
`mi-casa-su-casa` (see `wrangler.jsonc`).

See also: [`operations.md`](./operations.md) (logs, health, alerts) and
[`ci-cd-architecture.md`](./ci-cd-architecture.md) (how deploys and migrations run).

## 1. Roll back a bad Worker deploy

Every deploy creates a Worker **version**; rolling back does not touch the database.

```bash
npx wrangler versions list --env production          # find the previous healthy version id
npx wrangler rollback --env production <version-id>  # or omit the id to pick interactively
```

Because migrations are applied right before the matching code ships (expand/contract), the previous version keeps working against the current schema. If a migration itself is the problem, see §3.

## 2. Back up the database

D1 keeps **Time Travel** history (30 days on paid plans, 7 on free). Before anything risky, record a bookmark:

```bash
npx wrangler d1 time-travel info mi-casa-su-casa --env production
```

For an offline copy (recommended weekly, e.g. from a scheduled GitHub Action that uploads to R2 or an artifact):

```bash
npx wrangler d1 export mi-casa-su-casa --env production --remote --output backup-$(date +%F).sql
```

Restore an export into a fresh database with `wrangler d1 execute <db> --remote --file backup.sql`.

## 3. Restore the database (bad migration, accidental delete)

```bash
# Inspect what is available
npx wrangler d1 time-travel info mi-casa-su-casa --env production
# Restore to a point in time (UTC) or to a bookmark
npx wrangler d1 time-travel restore mi-casa-su-casa --env production --timestamp "2026-08-20T18:00:00Z"
```

After restoring, roll the Worker back to the version that matches the restored schema (§1), then fix forward with a **new** migration — never edit an applied migration file. D1 records applied migrations in `d1_migrations`; if you restored to before a migration ran, that row is gone too, so the next deploy re-applies it.

## 4. Re-apply or inspect migrations manually

Use the **Production D1 Migrate** workflow (Actions → *Production D1 Migrate* → *Run workflow*) behind the protected environment, or locally:

```bash
npx wrangler d1 migrations list mi-casa-su-casa --env production --remote
npx wrangler d1 migrations apply mi-casa-su-casa --env production --remote
```

D1 does not support SQL transactions or `PRAGMA foreign_keys`; keep migrations additive and idempotent (`IF NOT EXISTS`, `INSERT OR IGNORE`). A CI test rejects `PRAGMA foreign_keys` in new migration files.

## 5. Recover a lost owner account

**Owner forgot their password:** use *Forgot your password?* on the login page (requires `OUTBOUND_EMAIL_FROM` to be working). With 2FA enabled and the authenticator lost, backup codes work at the challenge step.

**No usable owner at all (2FA + backup codes lost, or the only owner left):**

```bash
# Promote an existing member to owner (replace the ids)
npx wrangler d1 execute mi-casa-su-casa --env production --remote \
  --command "UPDATE household_memberships SET role = 'owner' WHERE household_id = '<household-id>' AND user_id = '<user-id>';"
# Turn 2FA off for a locked-out user (they should re-enable it afterwards)
npx wrangler d1 execute mi-casa-su-casa --env production --remote \
  --command "UPDATE user SET twoFactorEnabled = 0 WHERE email = 'owner@example.com'; DELETE FROM two_factor WHERE user_id = (SELECT id FROM user WHERE email = 'owner@example.com');"
```

**Installation owner must be re-created** (account deleted): set `OWNER_EMAIL`/`SETUP_SECRET` on the Worker again and reopen setup:

```bash
npx wrangler d1 execute mi-casa-su-casa --env production --remote \
  --command "UPDATE app_installation SET status = 'pending', owner_user_id = NULL, owner_email = NULL, completed_at = NULL WHERE id = 1;"
```

Then visit `/setup`. Existing households are untouched; add the new owner to them with the query above.

## 6. Rotate secrets

| Secret | How | Effect |
| --- | --- | --- |
| `AUTH_SECRET` | Dashboard → Worker → Settings → Variables and Secrets (or `wrangler secret put AUTH_SECRET --env production`) | all sessions become invalid; everyone signs in again |
| `SETUP_SECRET` | delete it after setup (it is only needed once); set a new one only when reopening setup (§5) | none while setup is locked |
| `CLOUDFLARE_API_TOKEN` (GitHub secret) | create a new token (docs → ci-cd-architecture), update the repository secret, revoke the old one | next CI run uses the new token |

Plaintext variables set in the dashboard survive deploys (`keep_vars` in `wrangler.jsonc`).

## 7. Reset the shared preview database

All pull requests deploy to one preview Worker and D1. If a PR's migration left it in a bad state:

```bash
npx wrangler d1 time-travel restore mi-casa-su-casa-preview --env preview --timestamp "<before the bad migration>"
# or start over:
npx wrangler d1 delete mi-casa-su-casa-preview && npx wrangler d1 create mi-casa-su-casa-preview
# then update the D1_DATABASE_ID_PREVIEW GitHub secret with the new id
```

## 8. Inbound mail stopped arriving

1. `docs/email-routing.md` → Troubleshooting (routing rule, MX records, Worker deployed).
2. Workers Logs: filter `event:"email_rejected"` (unknown recipient / too large / quarantine full) and `event:"email_ingest_failed"`.
3. `GET /api/health/ready` → `status` must be `ready` (not `misconfigured`).
4. Remember the local part of the address must equal a household slug.
