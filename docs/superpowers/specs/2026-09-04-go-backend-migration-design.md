# Go backend migration — design

Date: 2026-09-04
Status: approved; implementation in progress

## Summary

Mi Casa Su Casa leaves Cloudflare Workers. The backend becomes a single static
Go binary that embeds a pre-built React SPA and runs from a distroless
container image published to GHCR. Postgres is the only external service.
Inbound household mail arrives through a Mailgun route webhook; outbound mail
goes through SMTP. Auth moves from Better Auth to Limen. The frontend keeps
React 19 and MUI but swaps React Router for TanStack Router and adopts typed
API and auth clients.

The build, release and self-hosting story is copied from Pjokk
(github.com/refsdal/pjokk): natively built binaries, a COPY-only Dockerfile,
GoReleaser driven by svu-computed versions, cosign-signed images, and a
compose file for self-hosters.

Decisions taken during brainstorming, in the order they were made:

| Question | Decision |
| --- | --- |
| Inbound mail | Webhook from a mail provider, not a built-in SMTP receiver |
| Provider | Mailgun routes |
| Database | Postgres, like Pjokk (pgx, sqlc, goose) |
| Auth | Limen; passkeys dropped for now |
| Frontend | Keep MUI and the redesigned screens; swap router and client layers |
| Existing data | Fresh start, no D1 import |
| Landing | Incremental PRs to `main`, new code side by side with `src/` |

## Goals

- One image that runs anywhere Docker runs, as small as practical
  (distroless static, non-root, no shell).
- One process serving API, auth, webhook and SPA on one origin.
- Feature parity with the Workers app except passkeys.
- The existing test bar: every PR ships with tests; the Go suite runs against
  a real Postgres.
- Production on Cloudflare keeps deploying from `src/` until the cutover PR.

## Non-goals

- Importing data from D1. The Go version starts empty; `/setup` runs again.
- Passkeys. They return as a follow-up once Limen or a custom plugin covers
  WebAuthn.
- A built-in SMTP listener or a second inbound provider adapter.
- A visual redesign. Screens change only where the API or auth shape changes.
- Kubernetes manifests. Dispatch modes make orchestration possible; the repo
  ships compose files only.

## Architecture

### One process, one image, one origin

```
browser ──HTTPS──▶ reverse proxy ──▶ mi-casa (Go, :3000) ──▶ Postgres
                                        │
Mailgun route ──POST /api/inbound/mailgun/mime──┘
mi-casa ──SMTP──▶ relay (Mailgun SMTP or any other)
```

The binary is also the dispatch table, selected by `argv[1]`:

| Mode | Behaviour |
| --- | --- |
| (none) | apply migrations under an advisory lock, then serve HTTP and run the scheduler |
| `server` | HTTP only; never migrates, never schedules (what replicas run) |
| `worker` | scheduler only, plus a bare `/healthz` |
| `migrate` | apply migrations, exit 0/1 |
| `cron retention` | run the retention job once, exit 0/1; unknown job name exits 2 |
| `healthcheck` | probe `/healthz` on this container, exit 0/1 (the image's HEALTHCHECK) |

### Repository layout

```
apps/server/                  Go module github.com/andersro93/mi-casa-su-casa/server
  cmd/mi-casa/main.go         composition root and dispatch table
  internal/config             env parsing and validation, all problems at once
  internal/db                 pgx pool, goose migrations (embedded), sqlc output
  internal/auth               Limen wiring, session helpers, user provisioning
  internal/api                generated strict server + handlers, middleware, Deps
  internal/mail               inbound (Mailgun, MIME parsing, classify, extract) and outbound (SMTP)
  internal/jobs               retention
  internal/cron               robfig/cron scheduler, UTC
  internal/web                go:embed SPA, fallback, security headers
  internal/testrig            Postgres + in-process HTTP rig for tests
openapi/mi-casa.yaml          hand-written spec, single source of truth
apps/frontend/                the SPA (moved from src/client)
scripts/                      build-artifacts.sh, spa-embed-overlay.sh, restore-embed-overlay.sh, build-image.sh
Dockerfile                    COPY-only, distroless static, non-root
.goreleaser.yaml
.mise.toml                    toolchain pins and tasks
docker-compose.yml            build from source (contributors)
docker-compose.selfhost.yml   pull the published image (self-hosters)
docker-compose.test.yml       Postgres for the Go suite
src/                          the Workers app; untouched until the cutover PR
```

### Toolchain

`.mise.toml` pins Go, Bun, sqlc, oapi-codegen, goose, goreleaser, svu, cosign
and syft. CI installs from the same file. Bun replaces npm for the frontend
workspace; `bun.lock` is committed. Biome keeps lint and format duties.
Generated code (oapi-codegen, sqlc) is committed; CI never runs `go generate`
and a drift test fails when the committed output is stale.

### Spec first

`openapi/mi-casa.yaml` describes every `/api/*` route except Limen's own
`/api/auth/*` surface. It drives three things:

- `oapi-codegen` generates the strict server interface and types into
  `internal/api/gen`.
- `kin-openapi` validates every request against it as middleware.
- `openapi-typescript` generates `apps/frontend/src/lib/api-schema.d.ts` for
  `openapi-fetch`.

`internal/api/mi-casa.yaml` is a committed copy of the root spec that exists
only because `go:embed` cannot reach above the module root; the drift test
compares the two.

## API surface

The API is a port, not a redesign. Paths, verbs, request and response shapes
stay as they are in `src/server/routes` so screens change minimally.

| Area | Routes |
| --- | --- |
| health | `GET /healthz`, `GET /readyz` (readiness runs a database query and reports retention staleness, as today's `/api/health/ready`) |
| setup | `GET /api/setup/status`, `POST /api/setup/complete` |
| households | `GET /api/households/me`, `POST /api/households`, `POST /api/households/:slug/leave` |
| inbox | `GET /api/inbox/:slug/providers`, `GET /api/inbox/:slug/providers/:providerKey`, `PATCH /api/inbox/:slug/messages/:messageId/status`, `GET /api/inbox/:slug/quarantine`, `POST /api/inbox/:slug/quarantine/:messageId/review` |
| admin: providers | `GET/POST /api/admin/:slug/providers`, `PATCH/DELETE /api/admin/:slug/providers/:providerId`, `POST /api/admin/:slug/provider-rules`, `PATCH/DELETE /api/admin/:slug/provider-rules/:ruleId` |
| admin: members | `GET /api/admin/:slug/members`, `POST /api/admin/:slug/members`, `DELETE /api/admin/:slug/members/:userId`, `PATCH /api/admin/:slug/members/:userId/role`, `POST/DELETE /api/admin/:slug/members/:userId/provider-access` |
| admin: invitations | `GET/POST /api/admin/:slug/invitations`, `POST /api/admin/:slug/invitations/:invitationId/resend`, `DELETE /api/admin/:slug/invitations/:invitationId` |
| admin: settings | `GET /api/admin/:slug/audit`, `GET/PATCH /api/admin/:slug/settings` |
| invitations | `GET /api/invitations/lookup`, `POST /api/invitations/accept` |
| settings | `GET /api/settings`, `GET /api/settings/households`, `PATCH /api/settings/profile`, `DELETE /api/settings/sessions/others`, `DELETE /api/settings/sessions/:sessionId` |
| inbound | `POST /api/inbound/mailgun/mime` |
| auth | Limen under `/api/auth/*` (credential sign-in and sign-out, password reset, two-factor, session) |

Two changes from today: the auth routes are Limen's rather than Better
Auth's, and the inbound email entrypoint is an HTTP route rather than the
Workers `email()` handler. `/api/health/live` and `/api/health/ready` become
`/healthz` and `/readyz` to match Pjokk's probes and the image healthcheck.

Unknown `/api/*` paths answer JSON 404 and never fall through to the SPA.

## Backend components

### config

`internal/config` parses the environment once at startup and reports every
problem together. Nothing else reads `os.Getenv`.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres DSN |
| `APP_URL` | yes | public origin; must be `https://` unless `ENVIRONMENT` is `development` or `test`; drives cookie Secure and link generation |
| `AUTH_SECRET` | yes | at least 32 characters; hashed to Limen's 32-byte key |
| `SETUP_SECRET` | yes | one-time secret for `/setup` |
| `OWNER_EMAIL` | yes | first owner account created by `/setup` |
| `EMAIL_DOMAIN` | yes | domain of household inbox addresses |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | yes | verifies inbound route posts |
| `SMTP_URL` | yes | `smtp://user:pass@host:587` or `smtps://…`; STARTTLS on `smtp://` |
| `OUTBOUND_EMAIL_FROM` | yes | sender for invitation and reset mail |
| `APP_NAME` | no | display name, default "Mi Casa Su Casa" |
| `ENVIRONMENT` | no | `development`, `test` or `production` (default) |
| `PORT` | no | default 3000 |
| `TRUSTED_PROXY_HOPS` | no | default 0; how many `X-Forwarded-For` entries to trust |
| `LOG_LEVEL` | no | default `info` |

Misconfiguration exits before the listener opens. `/healthz` never depends on
configuration beyond `PORT`.

### db

- `pgx/v5` pool built once in `cmd/mi-casa`, passed down through `Deps`.
- `sqlc` generates typed queries from SQL files in `internal/db/queries`.
- `goose` migrations embedded from `internal/db/migrations`, applied with
  `pg_advisory_lock` on a single pinned connection so several containers
  booting together serialise. The lock key is fixed and documented as
  never-changing.
- Schema: the current tables translated to Postgres types (`timestamptz`,
  `text`, `boolean`, `jsonb` where the SQLite schema stored JSON strings):
  `households`, `household_memberships`, `household_member_provider_access`,
  `providers`, `sender_rules`, `messages`, `quarantine_messages`,
  `household_invitations`, `household_invitation_provider_access`,
  `audit_events`, `app_installation`, `rate_limit` (the app's own counters).
  Limen owns `users`, `sessions`, `accounts`, `verifications`, its
  two-factor table and its `rate_limits` table. Foreign keys from our tables
  to Limen's user table are kept.
- Ids are text UUIDs generated by the application, as today.

### auth

Limen with:

- `credential-password` plugin: sign-in, sign-out, password change, reset by
  email. Minimum password length 12, maximum 128. Reset revokes other
  sessions.
- `two-factor` plugin: TOTP (issuer `APP_NAME`) and backup codes; email OTP
  disabled. State changes revoke other sessions.
- Session: 30 days, refreshed at most daily; cookie Secure when `APP_URL` is
  https; client address stored as a keyed digest, never raw; `TRUSTED_PROXY_HOPS`
  decides which forwarded address counts.
- Limen's built-in rate limiter with the same per-route budgets as today's
  Better Auth rules (5 sign-ins per minute, 3 reset requests per 5 minutes,
  5 resets per 5 minutes, 5 TOTP and 5 backup-code verifications per minute).
- Sign-up disabled on the HTTP surface. Users are created only by `/setup`
  (owner) and invitation acceptance (member), through Limen's core API from
  our own handlers.
- The owner/member role lives in `household_memberships` as today. There is
  no global admin role; the `user.role` column from Better Auth is dropped.
- Limen's public user id is different from the row id; our tables key on the
  row id and the API exposes the row id, as Pjokk does.

### api

- stdlib `net/http` mux plus the generated strict server; no framework.
- `internal/api` receives a `Deps` struct (pool, queries, auth service, mail
  sender, clock, logger) and never reads the environment.
- Middleware order per request: security headers, request id and structured
  logging of failed API requests, same-site check on mutating `/api/*`
  requests (`Sec-Fetch-Site` and `Origin` against `APP_URL`), OpenAPI request
  validation, session loading, household scoping by slug with membership and
  provider-access checks.
- No CORS middleware: the SPA is same-origin. A future native client is out
  of scope.
- Error responses keep today's `{ "error": "…" }` shape and status codes;
  validation failures answer 400 with the field problems.
- The app's own rate limiter (setup: 5 per 15 minutes; invitations: 20 per 10
  minutes; household creation: 10 per hour) uses the `rate_limit` table keyed
  on rule name plus address digest.

### mail

Inbound, `POST /api/inbound/mailgun/mime`:

1. Read the multipart form (limit 2 MiB for `body-mime`; larger answers 406).
2. Verify `signature` = hex HMAC-SHA256(`MAILGUN_WEBHOOK_SIGNING_KEY`,
   `timestamp` + `token`) with constant-time comparison; reject timestamps
   older than 5 minutes; reject a `token` seen in the last 10 minutes
   (in-memory set, bounded). Failures answer 401 and are logged.
3. Require `body-mime`; parse with `emersion/go-message` into the same
   `ParsedIncomingEmail` shape as today: envelope sender and recipient,
   `From` header address, `Message-ID` (or the deterministic synthetic id),
   date, subject, text body (HTML stripped to text when no text part,
   truncated at 64 KiB with a flag), and the sender authentication verdicts.
4. Authentication verdicts come from Mailgun's `X-Mailgun-Spf` (Pass,
   Neutral, Fail, SoftFail) and `X-Mailgun-Dkim-Check-Result` (Pass, Fail)
   headers, lower-cased into the existing `{spf, dkim, dmarc}` model; dmarc
   stays null unless an `Authentication-Results` header supplies one. The
   existing verdict rules apply unchanged: a `From`-header match needs
   dkim=pass or dmarc=pass; an envelope match needs spf=pass; dmarc=fail is
   never trusted.
5. Resolve the household from the recipient local part, classify against
   sender rules, extract the one-time code, store or quarantine.
6. Responses: 200 on stored or quarantined; 406 for permanent rejections
   (unknown recipient, too large, quarantine full, unparseable), which
   Mailgun does not retry; 500 for unexpected failures so Mailgun retries.

The classifier (`classify-email.ts`), code extractor (`extract-code.ts`),
header parsing and HTML-to-text helpers are ported function for function
with their test fixtures.

Outbound: an `smtp.Sender` over `SMTP_URL` sends the password-reset and
invitation messages with the same text and HTML bodies as today. Tests use a
recording sender. A `MailSender` interface sits between handlers and SMTP so
Limen's reset hook and the invitation handler share one path.

### jobs and cron

`internal/jobs.Retention` purges expired messages and quarantine rows in
bounded batches, expires pending invitations and records the run in
`app_installation`, exactly as `retention.ts`. `internal/cron` schedules it
daily at 03:00 UTC with `robfig/cron/v3` pinned to UTC, in default and
`worker` modes only. `cron retention` runs it once from the CLI.

### web

`internal/web` embeds `dist/` (a committed placeholder `index.html` keeps
`go build` and `go test` working without a frontend build; the overlay script
replaces it for artifacts). Static files are served with long cache headers
for hashed assets and `no-cache` for `index.html`, `sw.js` and the manifest.
Every non-API, non-probe path falls back to `index.html`. Security headers
match today's Hono configuration: the CSP (self, inline styles for Emotion,
`data:` and `https:` images, `data:` fonts, worker and manifest self,
frame-ancestors none), HSTS, `X-Frame-Options: DENY`, no-referrer, the
permissions policy. Probes get no SPA headers.

## Frontend

### Unchanged

React 19, MUI v9, the theme and fonts, every screen and component under
`src/client/components`, TanStack Query hooks, the PWA manifest and app-shell
service worker, the Vitest and Testing Library suite.

### Changed

- **Move**: `src/client` becomes `apps/frontend` in one mechanical PR (Vite
  config, tsconfig paths, test paths) before any behaviour changes.
- **Router**: TanStack Router in code-based mode, one `router.tsx`:
  - root: theme provider, query client, toaster
  - public: `/login`, `/two-factor`, `/forgot-password`, `/reset-password`,
    `/invite/$token`, `/setup`
  - authed: `/new-household`, `/settings`, and the household shell
    `/$slug` with children `inbox`, `inbox/$providerKey`, `quarantine`,
    `members`, `providers`, `settings`
  - `/` redirects to the first household's inbox or to `/new-household`
  - guards move from `App.tsx` into `beforeLoad` with `redirect`: session
    required, setup completed, household membership, owner-only views.
- **Auth client**: `limen-auth/react` with the credential and two-factor
  client plugins replaces the Better Auth client. Login, two-step
  enrolment, backup codes, reset and the devices list adapt to Limen's
  payloads. Passkey sections are removed from login and account settings.
- **API client**: `openapi-fetch` typed from the spec replaces `fetchJson`.
  Query hooks keep their names so screens change only at the call site.

### Tests

Existing page tests keep running. Tests that render with a React Router
memory router switch to a TanStack memory history; tests that mock the auth
client mock the Limen client instead. Build-time checks: typecheck,
Biome, `vite build`.

## Build, release and self-hosting

### Artifacts

`scripts/build-artifacts.sh` builds the SPA with Vite, overlays `dist/client`
into `apps/server/internal/web/dist`, cross-compiles `linux/amd64` and
`linux/arm64` with `CGO_ENABLED=0 -trimpath -ldflags "-s -w"`, and restores
the placeholder overlay on exit. `time/tzdata` is imported so the scratch-like
image resolves zones.

### Image

`Dockerfile` is COPY-only onto `gcr.io/distroless/static-debian12:nonroot`
pinned by digest: the binary for `TARGETPLATFORM`, `PORT=3000`, `EXPOSE 3000`,
`HEALTHCHECK CMD ["/app/mi-casa", "healthcheck"]`, `ENTRYPOINT
["/app/mi-casa"]`. No volume is needed: the app stores nothing on disk.

### CI on pull requests

`test.yml` (reusable): Biome, typecheck, frontend tests, `goreleaser check`,
`go vet`, `go test -p 1 -count=1 ./...` against a Postgres service container.
`ci.yml`: `test.yml`, then build artifacts, build the image, smoke-test it
(run `migrate` against a throwaway Postgres, start the default mode, wait for
`/readyz`, `GET /` returns the SPA, `POST /api/inbound/mailgun/mime` with a
bad signature returns 401), and push `ghcr.io/andersro93/mi-casa-su-casa:<next>-pr.<N>`
when the PR is not from a fork.

### Release on merge to main

`release.yml`: svu computes the next version from Conventional Commits since
the last `v*` tag (`--v0` rule; a manual `allow_major` input permits 1.0.0).
Unreleasable merges end green without a release. Otherwise the workflow
re-runs `test.yml`, tags, and GoReleaser publishes: linux archives, checksums,
SBOMs, keyless cosign signatures over the checksum file and the images, the
multi-arch image tagged `X.Y.Z`, `X.Y`, `X`, `latest`, `sha-<commit>`, and a
GitHub Release with the changelog. A failed publish deletes the tag.

### Self-hosting

- `docker-compose.selfhost.yml`: `postgres:17-alpine` plus the published
  image; secrets and `APP_URL` from the environment; no clone required.
- `docker-compose.yml`: builds from source via the artifact script.
- README "Self-hosting" section: Postgres, reverse proxy with TLS and
  `TRUSTED_PROXY_HOPS`, SMTP credentials, Mailgun receiving domain (MX
  records for `EMAIL_DOMAIN`), the Mailgun route
  `match_recipient(".*@EMAIL_DOMAIN")` → `forward("https://APP_URL/api/inbound/mailgun/mime")`,
  the HTTP webhook signing key, first-run `/setup`, upgrades (`migrate` before
  rollout), backups (Postgres only), and `cosign verify` instructions.
- `docs/email-routing.md` is rewritten for Mailgun; `docs/operations.md` and
  `docs/runbook.md` are updated for container operations.

### README

The README is rewritten in the shape of Pjokk's: logo and one-line pitch,
screenshots, what it does, a "Run it" quick start (`docker compose -f
docker-compose.selfhost.yml up -d` with the three secrets), the full
self-hosting guide (image tags and the pinning ladder, environment variable
table, reverse proxy, Mailgun receiving, SMTP, first-run setup, upgrades,
backups, verifying signatures), a development section (`mise install`, `bun
install`, `docker compose -f docker-compose.test.yml up -d`, `mise run test`,
`mise run e2e`, `mise run artifacts`, `mise run image`), the release model
("merging is releasing"), architecture at a glance, and contributing and
licence pointers. Cloudflare-specific sections are removed at cutover.

## Testing strategy

- Every TypeScript unit test file with a pure port (classifier, extractor,
  slug, authentication verdict, HTML entities, header parsing, secrets
  comparison) gets a Go counterpart with the same fixtures before the port
  is considered done.
- `internal/testrig` opens `TEST_DATABASE_URL`, applies migrations, truncates
  between tests, and builds `api.NewHandler` with real auth, a recording mail
  sender and a fixed clock. Route, invitation, setup, retention, tenant
  isolation, rate limit, security header and webhook tests drive it with real
  `http.Request` round trips.
- Drift tests: spec copy vs root spec; committed oapi-codegen and sqlc
  output vs fresh generation.
- Frontend tests stay in Vitest under `apps/frontend/test`.
- The image smoke test in CI proves the artifact runs, not only compiles.
- **End-to-end**: a Playwright suite under `e2e/` drives the real container
  image against a throwaway Postgres (`scripts/e2e-stack.sh up|down`, like
  Pjokk's), never the Vite dev server. One Chromium worker, mobile profile.
  Mail is captured rather than sent: the stack runs with `SMTP_URL` pointing
  at a Mailpit container, and specs read invitation and reset links from
  Mailpit's API. Inbound mail is exercised by posting a signed Mailgun-shaped
  form to the webhook with the stack's signing key. Specs cover: first-run
  setup, sign-in, two-factor enrolment and sign-in with a TOTP generated in
  the test, backup-code sign-in, password reset, invitation by email and by
  link, service and sender-rule management, an inbound message landing in
  the inbox with its code, quarantine review and release, member removal,
  and session revocation. `mise run e2e` wraps up, test, down; `ci.yml` runs
  the suite after the smoke test and uploads the Playwright report.

## Delivery order

One issue per PR, tests first, CI green, squash-merge. Each PR leaves `main`
deployable on Cloudflare.

1. Toolchain and skeleton: `.mise.toml`, Go module, `config`, `/healthz`,
   embed placeholder, `test.yml`, `docker-compose.test.yml`.
2. Schema and migrations in Postgres, sqlc queries, `testrig`.
3. Auth with Limen; `/setup`; invitation lookup and accept.
4. Households, providers and rules, members, invitations admin, settings,
   audit.
5. Inbox and quarantine routes.
6. Mail: Mailgun inbound, MIME parsing, classifier and extractor ports, SMTP
   outbound.
7. Retention job, cron, dispatch modes, `readyz` with retention staleness.
8. Frontend: move to `apps/frontend`; TanStack Router; limen-auth client and
   openapi-fetch; passkey UI removed.
9. Dockerfile, artifact scripts, image job, GoReleaser, `release.yml`,
   compose files.
10. Playwright end-to-end suite, e2e stack script, Mailpit in the stack, CI
    job.
11. README rewrite and docs (self-hosting guide, Mailgun receiving,
    operations, runbook).
12. Cutover: delete `src/`, `wrangler.jsonc`, `migrations/`, the Cloudflare
    workflows and the Cloudflare sections of the docs; update README and the
    package description. Rolling the new deployment out and moving MX to
    Mailgun is an operator step outside the repo.

## Risks and mitigations

- **Limen two-factor plugin is pre-release** (only a pseudo-version exists
  today). Pin the commit in `go.mod`; the two-factor route tests in `testrig`
  catch behaviour changes on upgrade.
- **Mailgun webhook details** were checked against Mailgun's documentation
  on 2026-09-04: a route URL ending in `mime` yields `body-mime`; posts carry
  `timestamp`, `token` and `signature` (hex HMAC-SHA256 over timestamp plus
  token with the HTTP webhook signing key); inbound mail carries
  `X-Mailgun-Spf` and `X-Mailgun-Dkim-Check-Result`; 406 stops retries. The
  handler's tests pin these with a recorded fixture.
- **Parity gaps** are caught by porting tests alongside code; the cutover PR
  is blocked until every route in the table above has a Go test.
- **Password hashes do not carry over**; irrelevant under the fresh-start
  decision.
