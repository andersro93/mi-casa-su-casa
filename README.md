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

- `BETTER_AUTH_SECRET`
- `OWNER_EMAIL`

Update `wrangler.jsonc` with your real D1 `database_id`.

### Apply local migrations

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
