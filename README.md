# Mi Casa Su Casa

![Mi Casa Su Casa logo](./assets/mi-casa-su-casa-logo.png)

Cloudflare-native shared verification inbox for families.

Mi Casa Su Casa gives invited family members a calm, mobile-friendly place to find verification emails and one-time codes for shared household accounts. Incoming email is processed directly on Cloudflare Workers, normalized into D1, grouped by sender/service, and quarantined when it cannot be classified safely.

## Why this exists

Households often share streaming and similar consumer accounts. When those services ask for an email verification code, the friction is not the login itself — it is quickly finding the right message and the right code. Mi Casa Su Casa is built to reduce that friction while keeping access boundaries explicit:

- one shared inbound address
- invite-only app access
- owner-controlled provider access
- owner-only quarantine and admin flows
- plain-text-only rendering in v1 for safety and simplicity

## Core principles

- **Cloudflare-native**: Worker, Email Routing, D1, Cron
- **Deployable main**: green CI should mean high confidence to deploy
- **Issue-first workflow**: features start as issues before implementation
- **Tests required**: every feature ships with tests
- **Open source from day one**: public repo, welcoming docs, contributor guidance

## Architecture

- **One Worker** (`src/index.ts`)
  - Hono API under `/api/*` (households, inbox, quarantine, admin, invitations, settings, setup, health)
  - Better Auth (email + password, passkeys, TOTP two-factor, password reset) under `/api/auth/*`
  - React/MUI single-page app served from Workers Static Assets; every request passes through the Worker so security headers apply everywhere
  - inbound `email()` handler: parse → authenticate sender (SPF/DKIM/DMARC results) → match sender rules → store or quarantine
  - daily `scheduled()` retention job (30-day purge, invitation expiry)
- **One D1 database** (hand-written migrations in `migrations/`, Drizzle mirror in `src/server/db/schema.ts`, drift guarded by tests)
  - Better Auth tables, households/memberships/invitations, providers/sender rules, messages/quarantine, audit events, rate-limit counters
- **One inbound address per household**: `<household-slug>@your-domain` routed to the Worker via Cloudflare Email Routing

## Current status

Feature-complete for a household deployment:

- multi-household tenancy with owner/member roles, invitations (email or shareable link), provider-scoped access, member removal and leaving
- first-run `/setup` with recovery paths, password reset, two-factor authentication with backup codes, passkeys, session management
- inbound mail classification with sender authentication, subdomain-aware domain rules, precise one-time-code extraction, quarantine review
- D1-backed rate limiting, CSRF/CORS hardening, security headers, structured logging, audit log, health endpoints with retention status
- CI (lint, typecheck, unit + real-D1 integration tests, build), preview deploys per PR, queued production deploy with migrations

See the [production-readiness tracking issue](https://github.com/andersro93/mi-casa-su-casa/issues/121) for what was reviewed and what remains (mostly internal refactors).

## Getting started

### Prerequisites

- Node.js 22+
- npm 10+
- Cloudflare account
- Wrangler authenticated locally
- A Cloudflare-managed domain with Email Routing enabled
- A D1 database created for this project

### Install dependencies

```bash
npm install
```

### Configure local environment

Copy the example env file:

```bash
cp .dev.vars.example .dev.vars
```

Fill in:

- `AUTH_SECRET`
- `SETUP_SECRET`

Set `OWNER_EMAIL` in the top-level `vars` section of `wrangler.jsonc` to your email address for local development. For CI/CD deployments, the D1 database IDs are injected from GitHub secrets, while runtime variables (`APP_URL`, `OWNER_EMAIL`, `OUTBOUND_EMAIL_FROM`) and secrets are set once per Worker in the Cloudflare dashboard and preserved across deploys (`keep_vars` in `wrangler.jsonc`) — see [`docs/ci-cd-architecture.md`](./docs/ci-cd-architecture.md).

### Apply local migrations

```bash
npm run db:apply:local
```

### Database schema and migrations

The hand-written SQL files in `migrations/` are the **source of truth** for the D1 schema and are applied with Wrangler (`npm run db:apply:local|preview|production`). `src/server/db/schema.ts` is a Drizzle mirror of that schema used for typed queries and by the Better Auth adapter — it must match the migrations exactly, and `test/integration/schema-drift.test.ts` fails CI if it does not (tables, columns, nullability, defaults, unique constraints, indexes).

To change the schema:

1. add a new numbered file under `migrations/` (migrations are append-only; never edit an applied one),
2. mirror the change in `src/server/db/schema.ts`,
3. run `npm run test:integration` — the drift test tells you about any mismatch.

`npm run db:generate` (drizzle-kit) is **not** part of the workflow; there is no Drizzle journal and it would emit a full initial schema.

### Start development

```bash
npm run dev
```

This runs:

- Vite build watch for the React client
- Wrangler dev with scheduled-handler testing enabled

### Quick local requests with `.http` files

The repo includes editor-friendly HTTP request files under [`requests/`](./requests):

- [`requests/health.http`](./requests/health.http)
- [`requests/email-ingestion.http`](./requests/email-ingestion.http)
- [`requests/scheduled.http`](./requests/scheduled.http)

These are meant to make common local verification flows fast and repeatable from editors like VS Code or JetBrains IDEs without rebuilding curl commands by hand.

They cover:

- app health endpoints
- local email ingestion into the Worker `email()` handler
- local scheduled retention cleanup

If your editor supports `.http` or REST client files, you can run these requests directly against the local dev server.

### Operations

Logging, health endpoints and the recommended alert set are described in [`docs/operations.md`](./docs/operations.md). Rollbacks, database backup/restore, lost-owner recovery and secret rotation are in [`docs/runbook.md`](./docs/runbook.md).

### Health endpoints

- `GET /api/health/live` — liveness check
- `GET /api/health/ready` — readiness check with a database query

### Test email ingestion locally

Cloudflare Email Workers can be tested locally by posting a raw RFC 5322 message to the dev endpoint:

- app route examples live under `/api/...`
- the email test hook lives under `/cdn-cgi/handler/email`

`/cdn-cgi/handler/email` is a Cloudflare/Wrangler development and testing endpoint that forwards a request to the Worker `email()` handler locally. It is not a normal application API route.

```bash
# The recipient's local part must be the slug of an existing household
# (the one you chose during /setup, e.g. `casa`); other addresses are dropped.
curl -X POST 'http://localhost:8787/cdn-cgi/handler/email?from=sender@example.com&to=casa@example.com' \
  --data-raw $'From: sender@example.com\nTo: casa@example.com\nSubject: Your verification code\nMessage-ID: <example-1@test>\n\nYour verification code is 123456'
```

### Test scheduled cleanup locally

```bash
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

## Quality gates

The project is designed so that successful checks on `main` are a strong deployment signal.

Required checks:

- formatting/linting (Biome)
- typecheck (TypeScript, including tests)
- unit tests (Node) and integration tests against a real local D1 inside the Workers runtime
- build verification

The baseline PR validation commands are:

```bash
npm run check
npm run typecheck
npm run test
npm run build
```

`main` should be protected so pull requests cannot merge unless the CI workflow is green.

## Deployment model

The repository includes a Cloudflare-focused CI/CD pipeline:

- `CI` validates pull requests and pushes to `main`
- `Preview Deploy` deploys pull requests to a preview Worker and preview D1 database
- `Production Deploy` applies pending D1 migrations and deploys the Worker from `main` (queued, never cancelled mid-run)
- `Production D1 Migrate` is a manual recovery workflow behind a protected environment

See [`docs/ci-cd-architecture.md`](./docs/ci-cd-architecture.md) for the required GitHub secrets, Cloudflare setup, repository variables, environment protection rules, and the production migration workflow.

## Deploy your own instance

Fork this repository and follow the steps below. No source edits are needed — every environment-specific value is injected through GitHub secrets, GitHub variables, and the Cloudflare dashboard.

### 1. Create Cloudflare resources

```bash
# Install Wrangler and authenticate
npm i -g wrangler && wrangler login

# Create preview and production D1 databases
wrangler d1 create mi-casa-su-casa-preview
wrangler d1 create mi-casa-su-casa
```

Save the database UUIDs from the output — you will need them in the next step.

### 2. Create a Cloudflare API token

You need an API token so GitHub Actions can deploy on your behalf. A single token is used for preview deploys, production deploys, and production migrations.

**Account-owned tokens** (recommended — survives team changes, requires Super Administrator):

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com) → select your account → **Manage Account → Account API Tokens → Create Token**

**User-owned tokens** (fallback for non-Super-Admins):

1. Open [**API Tokens** in your profile](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**

Then for either type:

2. Choose the **Edit Cloudflare Workers** template and click **Use template**
3. Add one more permission: **Account → D1 → Edit** (required for database migrations)
4. Under **Account Resources**, select your account
5. Under **Zone Resources**, select **All zones** (or the specific zone for your domain)
6. Click **Continue to summary** → **Create Token**
7. Copy the token — it is only shown once

> **Where to find your Account ID**: open the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Workers & Pages** — your Account ID is shown in the right sidebar.

### 3. Add GitHub secrets

Go to your fork → **Settings → Secrets and variables → Actions → Secrets** and add:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (see above) |
| `CLOUDFLARE_API_TOKEN` | API token from step 2 |
| `D1_DATABASE_ID_PREVIEW` | UUID from `wrangler d1 create mi-casa-su-casa-preview` |
| `D1_DATABASE_ID_PRODUCTION` | UUID from `wrangler d1 create mi-casa-su-casa` |

### 4. Add GitHub variables

Go to **Settings → Secrets and variables → Actions → Variables** and add:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_PREVIEW_URL` | URL of your preview Worker (e.g. `https://mi-casa-su-casa-preview.<your-subdomain>.workers.dev`) — used for PR comment links |

### 5. Set Cloudflare dashboard variables and secrets

In the Cloudflare dashboard, go to **Workers & Pages → mi-casa-su-casa → Settings → Variables and Secrets**.

Add as **plaintext variables**:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Full URL of this deployment (e.g. `https://mi-casa-su-casa.example.com`) |
| `OWNER_EMAIL` | Email address for the initial owner account |
| `EMAIL_DOMAIN` | Domain of the household inbox addresses (`<slug>@EMAIL_DOMAIN`, e.g. `home.yourdomain.com`). Display only — shown to owners in household settings |
| `OUTBOUND_EMAIL_FROM` | Sender address for invitation and password-reset emails — must be on a domain enabled for sending in Cloudflare Email Routing. The Worker refuses API requests (503 `misconfigured`) until this, `APP_URL` and `AUTH_SECRET` are set |

Add as **encrypted secrets**:

| Secret | Purpose |
| --- | --- |
| `AUTH_SECRET` | Random string used by Better Auth to sign sessions (generate with `openssl rand -base64 32`) |
| `SETUP_SECRET` | One-time setup passphrase you choose for the initial owner account creation. Delete it after `/setup` succeeds |

Repeat for the preview Worker (`mi-casa-su-casa-preview`) if you want setup to work in preview environments. Use the preview URL for `APP_URL` in that Worker.

### 6. Configure repository protection

- Enable branch protection on `main` requiring the `CI` workflow to pass
- Create a `production-migrations` environment under **Settings → Environments** with required reviewers so production schema changes need explicit approval

### 7. Set up email routing

Your domain must be managed by Cloudflare (nameservers pointing to Cloudflare), and the Worker must be deployed at least once before Email Routing can target it.

In the Cloudflare dashboard:

1. Go to your domain → **Email → Email Routing → Overview**
2. Enable Email Routing if not already active — accept the MX and SPF DNS record changes Cloudflare proposes
3. Go to the **Routing rules** tab → **Create address**
4. Set the custom address to your **household slug** — the local part of the address must equal the slug chosen during `/setup` (e.g. household slug `casa` → `casa@yourdomain.com`). Mail to any other local part is dropped. Add one routing rule per household.
5. Under **Action**, select **Send to a Worker** and choose your deployed Worker (`mi-casa-su-casa`)
6. Save the rule

> **Already using another email provider?** Enabling Email Routing changes MX records. See [`docs/email-routing.md`](./docs/email-routing.md) for guidance on coexisting with Google Workspace, Microsoft 365, or other providers.

For the full email routing guide including the processing pipeline, local testing, and troubleshooting, see [`docs/email-routing.md`](./docs/email-routing.md).

### 8. Deploy and run first-time setup

Push to `main` or open a pull request — the GitHub Actions workflows will handle deployment automatically.

After the first successful deploy:

1. Visit `https://<your-production-url>/setup`
2. Enter the `OWNER_EMAIL` and `SETUP_SECRET` you configured, choose your name and password, and pick the household name and slug (the slug becomes the inbound address local part)
3. The initial owner account is created and the `/setup` route locks permanently
4. Remove `SETUP_SECRET` from the Worker's secrets in the Cloudflare dashboard — it was only needed once. The route stays locked (it answers 409 for any secret after setup), so keeping the secret around only adds risk

You're done. Invite family members through the app.

For full CI/CD details, see [`docs/ci-cd-architecture.md`](./docs/ci-cd-architecture.md).

## Testing strategy

The default test pyramid for Mi Casa Su Casa is:

- **Unit tests** (`test/**/*.test.ts(x)`, Node environment): parser rules, provider routing, permission logic, retention logic, component rendering
- **Integration tests** (`test/integration/**`, run inside the Workers runtime via `@cloudflare/vitest-pool-workers`): repositories, Better Auth and Worker handlers against a real local D1 with every migration in `migrations/` applied; the database is emptied before each test
- **End-to-end flows** are covered by the integration project through the Worker entrypoints (`SELF.fetch`, `worker.email()`, `worker.scheduled()`): setup, login, 2FA, password reset, invitations, inbound mail, retention

```bash
npm test                 # both projects
npm run test:unit        # Node-only unit tests
npm run test:integration # D1-backed tests in workerd
```

`test/integration/schema.test.ts` also asserts that every column Better Auth expects (for the configured plugins) exists in the migrated database, so schema drift fails CI instead of production.

No feature is considered done without tests.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

Highlights:

- features start as issues
- PRs are required for changes to `main`
- every PR should include tests or updated test coverage

## Security notes

Mi Casa Su Casa is intended as a private household tool. The app should not be treated as a password vault in v1, and it does not store service account passwords.

Brute-force protection is built in and backed by D1 (Workers have no shared memory): Better Auth limits sign-in to 5 attempts per minute per IP (reset/2FA/passkey endpoints have their own limits), `/api/setup/complete` allows 5 attempts per 15 minutes per IP, invitation-token lookups 20 per 10 minutes, and household creation 10 per hour. The client IP comes from Cloudflare's `cf-connecting-ip` header. For additional protection you can add Cloudflare WAF rate-limiting rules in front of `/api/auth/*` and `/api/setup/*`.

## License

[MIT](./LICENSE)
