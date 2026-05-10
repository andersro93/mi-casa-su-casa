# CI/CD architecture

Mi Casa Su Casa uses GitHub Actions plus Wrangler to validate pull requests, publish preview deployments, deploy application code from `main`, and keep production D1 migrations behind an explicit approval gate.

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

`wrangler.jsonc` now separates preview and production bindings:

- top-level config is still local-development oriented
- `env.preview` deploys `mi-casa-su-casa-preview`
- `env.production` deploys `mi-casa-su-casa`
- preview and production use different D1 bindings and URLs

Replace the placeholder values before using these workflows:

- preview D1 database id: `11111111-1111-1111-1111-111111111111`
- production D1 database id: `22222222-2222-2222-2222-222222222222`
- preview URL placeholders in `APP_ORIGIN` and `BETTER_AUTH_URL`
- production URL placeholders in `APP_ORIGIN` and `BETTER_AUTH_URL`

## Required GitHub secrets

Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account used by Wrangler |
| `CLOUDFLARE_API_TOKEN` | Preview deploy token scoped to Workers + D1 for the preview account |
| `CLOUDFLARE_API_TOKEN_PROD` | Production deploy and migration token scoped to Workers + D1 for production |

Cloudflare recommends scoping API tokens to the single account they need to manage.

## Recommended GitHub variables

Add these repository variables if you want richer workflow output:

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_PREVIEW_URL` | URL that the preview workflow comments on pull requests |
| `CLOUDFLARE_PRODUCTION_URL` | URL shown on the protected migration environment |

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
npm run db:apply:local
npm run db:apply:preview
npm run db:apply:production
```

## Manual setup still required

This issue adds the repository-side CI/CD wiring, but operators still need to:

1. create the preview and production D1 databases in Cloudflare
2. replace placeholder IDs and URLs in `wrangler.jsonc`
3. create the GitHub secrets and variables listed above
4. enable branch protection on `main` so `CI` stays required
5. configure required reviewers for the `production-migrations` environment

## Deploy to Cloudflare onboarding for issue #9

Use this repository button for the Cloudflare-native deploy entry point:

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/andersro93/mi-casa-su-casa)
```

What the Deploy to Cloudflare flow handles well:

- creating the Worker deployment
- provisioning D1 resources defined in Wrangler
- prompting for environment variables and secrets needed at deploy time

What still remains manual after deployment:

- visit `/setup` to create the first owner account
- provide the configured `OWNER_EMAIL` and `SETUP_SECRET`
- onboard the email-routing domain in Cloudflare and create the inbound rules for the shared inbox address

Recommended first-run secrets for onboarding:

- `BETTER_AUTH_SECRET`
- `OWNER_EMAIL`
- `SETUP_SECRET`

The app-level setup route is intentionally one-time only. After the owner account is created, `/setup` is locked server-side and normal invite-only sign-in remains the only public auth path.

## References

- Cloudflare Workers GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Cloudflare Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare D1 environments: https://developers.cloudflare.com/d1/configuration/environments/
- Cloudflare D1 commands: https://developers.cloudflare.com/workers/wrangler/commands/d1/
- Cloudflare preview URLs: https://developers.cloudflare.com/workers/configuration/previews/
