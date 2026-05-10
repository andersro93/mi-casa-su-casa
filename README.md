# Mi Casa Su Casa

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

## Planned architecture

- **One Worker**
  - Hono API
  - Better Auth endpoints
  - React asset serving
  - inbound `email()` handler
  - scheduled retention cleanup
- **One D1 database**
  - Better Auth tables
  - inbox/quarantine/provider access tables
- **One shared inbound email address** routed to the Worker

## Current status

This repository is in the bootstrap phase.

The initial tracked work lives in GitHub issues:

- #1 Establish CI, branch policy, and testing gates
- #2 Create inbox, quarantine, and message-status UX
- #3 Initialize Cloudflare-native app stack
- #4 Build email ingestion, normalization, and quarantine pipeline
- #5 Bootstrap repository foundations
- #6 Implement invite-only auth and owner-managed access control
- #7 Add local `.http` request files for manual dev triggers and health checks
- #8 Implement full CI/CD for PR validation, preview deploys, and protected production release
- #9 Add Deploy to Cloudflare onboarding flow with first-run setup for initial admin creation

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

Set `OWNER_EMAIL` in the top-level `vars` section of `wrangler.jsonc` to your email address for local development. For CI/CD deployments, all environment-specific values (D1 database IDs, URLs, owner email) are injected automatically from GitHub secrets and variables — see [`docs/ci-cd-architecture.md`](./docs/ci-cd-architecture.md).

### Apply local migrations

```bash
npm run db:apply:local
```

### Generate Drizzle migrations

Better Auth tables and app tables are now represented in Drizzle schema definitions while Cloudflare D1 remains the runtime database.

Generate new migration SQL with:

```bash
npm run db:generate
```

Apply the generated SQL through the existing Wrangler migration flow:

```bash
npm run db:apply:local
```

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

### Health endpoints

- `GET /api/health/live` — liveness check
- `GET /api/health/ready` — readiness check with a database query

### Test email ingestion locally

Cloudflare Email Workers can be tested locally by posting a raw RFC 5322 message to the dev endpoint:

- app route examples live under `/api/...`
- the email test hook lives under `/cdn-cgi/handler/email`

`/cdn-cgi/handler/email` is a Cloudflare/Wrangler development and testing endpoint that forwards a request to the Worker `email()` handler locally. It is not a normal application API route.

```bash
curl -X POST 'http://localhost:8787/cdn-cgi/handler/email?from=sender@example.com&to=codes@example.com' \
  --data-raw $'From: sender@example.com\nTo: codes@example.com\nSubject: Your verification code\nMessage-ID: <example-1@test>\n\nYour verification code is 123456'
```

### Test scheduled cleanup locally

```bash
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

## Quality gates

The project is designed so that successful checks on `main` are a strong deployment signal.

Required checks are expected to include:

- formatting/linting
- typecheck
- unit tests
- integration tests
- end-to-end tests for critical flows
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

The repository now includes a Cloudflare-focused CI/CD baseline for issue #8:

- `CI` validates pull requests and pushes to `main`
- `Preview Deploy` deploys pull requests to a preview Worker and preview D1 database
- `Production Deploy` automatically deploys Worker code from `main`
- `Production D1 Migrate` is a separate, manually approved workflow for production schema changes

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

### 2. Add GitHub secrets

Go to your fork → **Settings → Secrets and variables → Actions → Secrets** and add:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token for preview deploys (Workers + D1 scope) |
| `CLOUDFLARE_API_TOKEN_PROD` | API token for production deploys and migrations (Workers + D1 scope) |
| `D1_DATABASE_ID_PREVIEW` | UUID from `wrangler d1 create mi-casa-su-casa-preview` |
| `D1_DATABASE_ID_PRODUCTION` | UUID from `wrangler d1 create mi-casa-su-casa` |

### 3. Add GitHub variables

Go to **Settings → Secrets and variables → Actions → Variables** and add:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_PREVIEW_URL` | URL of your preview Worker (e.g. `https://mi-casa-su-casa-preview.<your-subdomain>.workers.dev`) |
| `CLOUDFLARE_PRODUCTION_URL` | URL of your production deployment (e.g. `https://mi-casa-su-casa.<your-domain>.com`) |
| `OWNER_EMAIL` | Email address for the initial owner account |

### 4. Set Cloudflare dashboard secrets

In the Cloudflare dashboard, go to **Workers & Pages → mi-casa-su-casa → Settings → Variables and Secrets** and add as encrypted secrets:

| Secret | Purpose |
| --- | --- |
| `AUTH_SECRET` | Random string used by Better Auth to sign sessions (generate with `openssl rand -base64 32`) |
| `SETUP_SECRET` | One-time setup passphrase you choose for the initial owner account creation |

Repeat for the preview Worker (`mi-casa-su-casa-preview`) if you want setup to work in preview environments.

### 5. Configure repository protection

- Enable branch protection on `main` requiring the `CI` workflow to pass
- Create a `production-migrations` environment under **Settings → Environments** with required reviewers so production schema changes need explicit approval

### 6. Set up email routing

In the Cloudflare dashboard:

1. Go to your domain → **Email → Email Routing**
2. Create a routing rule that forwards your shared inbox address (e.g. `codes@yourdomain.com`) to the Worker

### 7. Deploy and run first-time setup

Push to `main` or open a pull request — the GitHub Actions workflows will handle deployment automatically.

After the first successful deploy:

1. Visit `https://<your-production-url>/setup`
2. Enter the `OWNER_EMAIL` and `SETUP_SECRET` you configured
3. The initial owner account is created and the `/setup` route locks permanently

You're done. Invite family members through the app.

For full CI/CD details, see [`docs/ci-cd-architecture.md`](./docs/ci-cd-architecture.md).

## Testing strategy

The default test pyramid for Mi Casa Su Casa is:

- **Unit tests**: parser rules, provider routing, permission logic, retention logic
- **Integration tests**: Hono routes, Better Auth behavior, D1-backed flows, Worker handlers
- **End-to-end tests**: invite/login, provider-scoped inbox access, owner quarantine review

No feature is considered done without tests.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

Highlights:

- features start as issues
- PRs are required for changes to `main`
- every PR should include tests or updated test coverage

## Security notes

Mi Casa Su Casa is intended as a private household tool. The app should not be treated as a password vault in v1, and it does not store service account passwords.

## License

[MIT](./LICENSE)
