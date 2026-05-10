# CI/CD architecture

Mi Casa Su Casa uses GitHub Actions plus Wrangler to validate pull requests, publish preview deployments, deploy application code from `main`, and keep production D1 migrations behind an explicit approval gate.

Drizzle now owns schema definitions and migration generation. Wrangler continues to apply the checked-in SQL migrations to Cloudflare D1 in local, preview, and production environments.

## Workflow layout

### 1. `CI`

File: `.github/workflows/ci.yml`

Runs on every pull request and on pushes to `main`.

Commands:

```bash
npm ci
npm run check
npm run typecheck
npm run test
npm run build
```

This is the required validation workflow that should block merges when red.

### 2. `Preview Deploy`

File: `.github/workflows/preview-deploy.yml`

Runs on pull requests from branches in this repository.

Flow:

1. install dependencies
2. run `npm run ci`
3. apply preview D1 migrations with `npm run db:apply:preview`
4. deploy preview Worker with `npm run deploy:preview`
5. comment on the pull request with the preview status

Fork pull requests do not get preview deploys by default because GitHub does not expose deployment secrets to fork-triggered workflows.

### 3. `Production Deploy`

File: `.github/workflows/production-deploy.yml`

Runs automatically on pushes to `main`.

Flow:

1. install dependencies
2. run `npm run ci`
3. deploy Worker code with `npm run deploy:production`

This keeps application deployments automatic when `main` is green.

### 4. `Production D1 Migrate`

File: `.github/workflows/production-d1-migrate.yml`

Runs only through `workflow_dispatch` and targets the protected GitHub environment `production-migrations`.

Flow:

1. choose the git ref to migrate
2. require environment approval in GitHub
3. install dependencies
4. run `npm run db:apply:production`
5. list production migrations afterward for audit visibility

This is the explicit production schema step required by issue #8.

## Wrangler environment model

`wrangler.jsonc` separates preview and production bindings:

- top-level config is local-development oriented
- `env.preview` deploys `mi-casa-su-casa-preview`
- `env.production` deploys `mi-casa-su-casa`
- preview and production use different D1 bindings

D1 `database_id` values are **not hardcoded** in `wrangler.jsonc`. They are injected at deploy time by the GitHub Actions workflows via `sed` from GitHub secrets before Wrangler runs.

Runtime variables (`APP_URL`, `OWNER_EMAIL`) and secrets (`AUTH_SECRET`, `SETUP_SECRET`) are configured directly in the Cloudflare dashboard for each Worker. They persist across deploys and do not depend on GitHub Actions.

This design means forkers never need to edit `wrangler.jsonc` — just add the required secrets and variables to their GitHub repository and Cloudflare dashboard.

## Required GitHub secrets

Add these repository secrets under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account used by Wrangler (found on the Workers & Pages overview sidebar) |
| `CLOUDFLARE_API_TOKEN` | API token for all deployments and migrations — see [Creating an API token](#creating-an-api-token) below |
| `D1_DATABASE_ID_PREVIEW` | UUID of the preview D1 database (from `wrangler d1 create`) |
| `D1_DATABASE_ID_PRODUCTION` | UUID of the production D1 database (from `wrangler d1 create`) |

A single token is used for preview deploys, production deploys, and production migrations. Cloudflare recommends scoping API tokens to the single account they need to manage.

### Creating an API token

Create an **account-owned** token so CI/CD survives team changes (requires Super Administrator). If you are not a Super Administrator, create a user-owned token instead — both work the same way, but user tokens are revoked if the creating user loses access.

1. For an **account-owned token**: open the [Cloudflare dashboard](https://dash.cloudflare.com) → select your account → **Manage Account → Account API Tokens → Create Token**
2. For a **user-owned token**: open [**API Tokens** in your profile](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
3. Choose the **Edit Cloudflare Workers** template and click **Use template**
4. Add one more permission: **Account → D1 → Edit** (required for `wrangler d1 migrations apply`)
5. Under **Account Resources**, select only the account that owns your Workers
6. Under **Zone Resources**, select **All zones** (or the specific zone for your domain)
7. Click **Continue to summary** → **Create Token**
8. Copy the token — it is only shown once

## Required GitHub variables

Add these repository variables under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_PREVIEW_URL` | Full URL of the preview deployment — used for PR comment links (e.g. `https://mi-casa-su-casa-preview.example.workers.dev`) |

The preview workflow still deploys without `CLOUDFLARE_PREVIEW_URL`, but the pull request comment will only report status instead of a direct link.

## Required Cloudflare dashboard variables and secrets

In the Cloudflare dashboard, go to **Workers & Pages → your Worker → Settings → Variables and Secrets**.

Add as **plaintext variables**:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Full URL of this deployment (e.g. `https://mi-casa-su-casa.example.com`) |
| `OWNER_EMAIL` | Email address for the initial owner account |

Add as **encrypted secrets**:

| Secret | Purpose |
| --- | --- |
| `AUTH_SECRET` | Random string used by Better Auth to sign sessions (generate with `openssl rand -base64 32`) |
| `SETUP_SECRET` | One-time setup passphrase for initial owner account creation |

Repeat for both production (`mi-casa-su-casa`) and preview (`mi-casa-su-casa-preview`) Workers. Use the appropriate URL for `APP_URL` in each.

## Required GitHub environments

Create this environment under **Settings → Environments**:

### `production-migrations`

Use required reviewers here so production database changes require explicit approval.

Recommended settings:

- required reviewers enabled
- deployment branches limited to `main`
- optional wait timer if your release process benefits from a pause before migration approval

## D1 rollout guidance

Production app deploys and production D1 migrations are intentionally separate.

Use this operating model:

1. merge to `main`
2. let `Production Deploy` ship the Worker code automatically
3. review the release and run `Production D1 Migrate` when a schema change is intended

For schema changes, prefer backward-compatible rollouts:

- additive columns/tables before code depends on them
- cleanup and destructive changes only after compatible code is already live

## Local commands

Useful commands after this issue:

```bash
npm run ci
npm run deploy:preview
npm run deploy:production
npm run db:generate
npm run db:apply:local
npm run db:apply:preview
npm run db:apply:production
```

## Manual setup still required

This issue adds the repository-side CI/CD wiring, but operators still need to:

1. create the preview and production D1 databases in Cloudflare (`wrangler d1 create mi-casa-su-casa-preview` and `wrangler d1 create mi-casa-su-casa`)
2. add the GitHub secrets listed above (including the D1 database UUIDs from step 1)
3. add the GitHub variables listed above
4. set `APP_URL`, `OWNER_EMAIL`, `AUTH_SECRET`, and `SETUP_SECRET` in the Cloudflare dashboard for each Worker (see table above)
5. enable branch protection on `main` so `CI` stays required
6. configure required reviewers for the `production-migrations` environment

No edits to `wrangler.jsonc` are needed — all environment-specific values are injected by the workflows.

## References

- Cloudflare Workers GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Cloudflare Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare D1 environments: https://developers.cloudflare.com/d1/configuration/environments/
- Cloudflare D1 commands: https://developers.cloudflare.com/workers/wrangler/commands/d1/
- Cloudflare preview URLs: https://developers.cloudflare.com/workers/configuration/previews/
