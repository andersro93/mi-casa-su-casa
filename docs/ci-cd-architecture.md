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

D1 `database_id` values and runtime variables (`APP_URL`, `OWNER_EMAIL`) are **not hardcoded** in `wrangler.jsonc`. They are injected at deploy time by the GitHub Actions workflows:

- D1 database IDs are replaced via `sed` from GitHub secrets before Wrangler runs
- `APP_URL` and `OWNER_EMAIL` are passed to Wrangler with `--var KEY:VALUE` at deploy time

This design means forkers never need to edit `wrangler.jsonc` — just add the required secrets and variables to their GitHub repository.

## Required GitHub secrets

Add these repository secrets under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account used by Wrangler |
| `CLOUDFLARE_API_TOKEN` | Preview deploy token scoped to Workers + D1 |
| `CLOUDFLARE_API_TOKEN_PROD` | Production deploy and migration token scoped to Workers + D1 |
| `D1_DATABASE_ID_PREVIEW` | UUID of the preview D1 database (from `wrangler d1 create`) |
| `D1_DATABASE_ID_PRODUCTION` | UUID of the production D1 database (from `wrangler d1 create`) |

Cloudflare recommends scoping API tokens to the single account they need to manage.

## Required GitHub variables

Add these repository variables under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_PREVIEW_URL` | Full URL of the preview deployment (e.g. `https://mi-casa-su-casa-preview.example.workers.dev`) |
| `CLOUDFLARE_PRODUCTION_URL` | Full URL of the production deployment (e.g. `https://mi-casa-su-casa.example.com`) |
| `OWNER_EMAIL` | Email address for the initial owner account |

`CLOUDFLARE_PREVIEW_URL` and `CLOUDFLARE_PRODUCTION_URL` are injected as the `APP_URL` binding in the respective environments. `OWNER_EMAIL` is injected as the `OWNER_EMAIL` binding.

The preview workflow still deploys without `CLOUDFLARE_PREVIEW_URL`, but the pull request comment will only report status instead of a direct link.

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
4. set `AUTH_SECRET` and `SETUP_SECRET` as encrypted secrets in the Cloudflare dashboard for the Worker
5. enable branch protection on `main` so `CI` stays required
6. configure required reviewers for the `production-migrations` environment

No edits to `wrangler.jsonc` are needed — all environment-specific values are injected by the workflows.

## References

- Cloudflare Workers GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Cloudflare Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare D1 environments: https://developers.cloudflare.com/d1/configuration/environments/
- Cloudflare D1 commands: https://developers.cloudflare.com/workers/wrangler/commands/d1/
- Cloudflare preview URLs: https://developers.cloudflare.com/workers/configuration/previews/
