# Go Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cloudflare Workers backend with a single static Go binary (stdlib `net/http`, Limen auth, pgx + sqlc + goose, embedded Vite SPA, distroless multi-arch image published by GoReleaser) at feature parity minus passkeys, with a Mailgun inbound webhook replacing Email Routing and SMTP replacing the Workers send binding, landed as a sequence of small PRs to `main`.

**Architecture:** Spec-first: `openapi/mi-casa.yaml` drives oapi-codegen (Go strict server) and openapi-typescript (SPA client). `cmd/mi-casa` is the sole composition root building a `Deps` struct; `internal/api` never reads the environment. Dispatch modes, tenancy middleware, advisory-lock migration and cron semantics are copied from Pjokk. The Workers app in `src/` stays untouched and deployable until the cutover PR.

**Tech Stack:** Go 1.27, `github.com/thecodearcher/limen` (+ credential-password, two-factor plugins), pgx/v5, sqlc, goose, oapi-codegen v2, kin-openapi nethttp-middleware, `github.com/emersion/go-message`, robfig/cron/v3, openapi-typescript + openapi-fetch, npm `limen-auth`, TanStack Router, Playwright, Mailpit, GoReleaser, svu, cosign, syft, mise, Bun.

**Spec:** `docs/superpowers/specs/2026-09-04-go-backend-migration-design.md`
**Parity contract:** `docs/superpowers/plans/2026-09-04-go-migration-reference.md` (cited as REF §…). `src/server/**` is ground truth when REF is ambiguous.
**Template repo:** `/home/anders/projects/refsdal/pjokk` (Pjokk). When a task says "as Pjokk's X", open that file and copy the shape, renaming `pjokk` → `mi-casa`, `refsdal/pjokk` → `andersro93/mi-casa-su-casa`.

## Global Constraints

- Toolchain: `mise install` at the repo root provides Go, Bun, sqlc, oapi-codegen, goose, goreleaser, svu, cosign, syft. Run every go/bun/codegen command through `mise exec -- <cmd>` or after `eval "$(mise activate bash)"`. Node is also provided by mise (memory: no global node).
- Go module path `github.com/andersro93/mi-casa-su-casa/server` rooted at `apps/server/`.
- Tests run against a real Postgres: `docker compose -f docker-compose.test.yml up -d` → `TEST_DATABASE_URL` default `postgres://micasa:micasa@127.0.0.1:55433/micasa_test`. Run Go tests with `go test -p 1 -count=1 ./...` (packages share one database).
- Error envelope on every API error: `{"error": string}` plus optional `fields` / `code` exactly as REF §A1. Status codes and messages verbatim from REF §A2.
- Every domain query is household-scoped: no handler touches a household table without `household_id` from the resolved membership (REF §A1 guards).
- Postgres rules: `timestamptz` everywhere; unique violations by SQLSTATE 23505 (`pgconn.PgError.Code`); `"users"` quoted in hand-written SQL; ids are app-generated UUID strings.
- Only `internal/auth` imports Limen packages. Pin Limen modules to exact versions in go.mod (REF §B0).
- Never store a raw client IP: rate-limit keys and session metadata use `sha256(AUTH_SECRET + "mi-casa/ip" + ip)` hex (REF §A1).
- Conventional Commits (`feat(server): …`, `feat(client): …`, `ci: …`, `docs: …`); every commit compiles and its tests pass.
- Codegen is committed: after editing `openapi/mi-casa.yaml` or `internal/db/queries/*.sql`, run `cd apps/server && go generate ./...` and commit the output.
- Biome formats TypeScript, YAML is hand-formatted, Go is `gofmt`. `go vet ./...` clean.
- One PR per phase (P1…P12). Each PR: branch from fresh `main`, all CI green (`ci.yml`, and until cutover the existing Cloudflare `CI`), squash-merge with `Closes #<issue>`, then next. Create the GitHub issue for a phase before opening its PR (memory: `gh issue create` prints the URL; capture it).
- The Workers app (`src/`, `wrangler.jsonc`, `migrations/`, existing workflows) is not modified before P12 except where a task says so (root `package.json` scripts and Biome config in P1, `vitest.config.ts` paths in P8).

---

## Phase P1 — Toolchain, Go skeleton, config, health, test workflow

### Task 1: Toolchain pins and repo scripts

**Files:**
- Create: `.mise.toml`, `docker-compose.test.yml`, `apps/server/go.mod`, `apps/server/cmd/mi-casa/main.go` (usage stub)
- Modify: `biome.json` (exclude `apps/server`, `dist`, `e2e/playwright-report`), `.gitignore` (add `dist/server`, `dist/goreleaser`, `apps/server/internal/web/dist/*` except placeholder, `e2e/playwright-report`, `e2e/test-results`)

**Interfaces:**
- Produces: `mise run test`, `mise run check`, `mise run artifacts`, `mise run image`, `mise run e2e`, `mise run snapshot` tasks (later tasks fill the scripts they call).

- [ ] **Step 1:** Write `.mise.toml` copying Pjokk's, with tools `go = "1.27.0"`, `bun = "1.4"`, `node = "22"`, the three `go:` codegen tools, `aqua:goreleaser/goreleaser`, `aqua:caarlos0/svu`, `aqua:sigstore/cosign`, `aqua:anchore/syft`, and tasks:
  ```toml
  [tasks.test]
  run = ["cd apps/server && go vet ./... && go test -p 1 -count=1 ./...", "bun run test"]
  [tasks.check]
  run = ["bun run check", "goreleaser check"]
  [tasks.artifacts]
  run = "bash scripts/build-artifacts.sh"
  [tasks.image]
  run = "bash scripts/build-image.sh"
  [tasks.snapshot]
  run = """
  trap 'bash scripts/restore-embed-overlay.sh' EXIT
  goreleaser release --snapshot --clean --skip=sign
  """
  [tasks.e2e]
  run = """
  trap 'bash scripts/e2e-stack.sh down' EXIT
  bash scripts/e2e-stack.sh up
  cd e2e && bunx playwright test
  """
  ```
  Until P9/P10 exist, `goreleaser check` and the scripts are absent; `mise run test` must work from this task on.
- [ ] **Step 2:** Write `docker-compose.test.yml` as Pjokk's with `POSTGRES_USER=micasa`, `POSTGRES_PASSWORD=micasa`, `POSTGRES_DB=micasa_test`, port `127.0.0.1:55433:5432`, tmpfs data, healthcheck.
- [ ] **Step 3:** `mkdir -p apps/server/cmd/mi-casa && cd apps/server && go mod init github.com/andersro93/mi-casa-su-casa/server` (edit `go 1.27`). `main.go` prints usage and exits 2 for now.
- [ ] **Step 4:** `mise install`; `cd apps/server && go build ./... && go vet ./...` passes.
- [ ] **Step 5:** Commit `chore: pin the Go/Bun toolchain with mise and add the Go module skeleton`.

### Task 2: Config loader

**Files:**
- Create: `apps/server/internal/config/config.go`
- Test: `apps/server/internal/config/config_test.go`

**Interfaces:**
- Produces: `type Config struct { DatabaseURL, AppURL, AppName, AuthSecret, SetupSecret, OwnerEmail, EmailDomain, MailgunSigningKey, SMTPURL, OutboundFrom, Environment, LogLevel string; Port, TrustedProxyHops int }`, `func Load(env map[string]string) (*Config, error)`, `func FromOS() (*Config, error)`, `func (c *Config) IsDevelopmentLike() bool`.

- [ ] **Step 1:** Write failing tests: minimal valid config loads; each required variable missing is reported by name; ALL problems reported in one error (assert the message mentions every bad key); `AUTH_SECRET` shorter than 32 rejected with `"must be at least 32 characters (openssl rand -hex 32)"`; `APP_URL` must be absolute; `APP_URL` `http://` rejected unless `ENVIRONMENT` is `development`/`test` (`"must use https outside development"`); `OWNER_EMAIL` must look like an email and is lower-cased; `EMAIL_DOMAIN` must match the hostname regex from REF §A4; `SMTP_URL` must parse with scheme `smtp` or `smtps` and a host; `OUTBOUND_EMAIL_FROM` must be an email; `PORT` default 3000, rejects `abc`/`0`; `TRUSTED_PROXY_HOPS` default 0, rejects `-1`; `APP_NAME` default `"Mi Casa Su Casa"`; `ENVIRONMENT` default `production`, rejects `staging`; `LOG_LEVEL` default `info`.
- [ ] **Step 2:** `go test ./internal/config/` — FAIL (undefined).
- [ ] **Step 3:** Implement: read the map, accumulate `problems []string` formatted `"KEY: message"`, return `fmt.Errorf("invalid configuration:\n  %s", strings.Join(problems, "\n  "))`. Pure stdlib (`net/url`, `net/mail`, `regexp`).
- [ ] **Step 4:** `go test ./internal/config/` — PASS.
- [ ] **Step 5:** Commit `feat(server): validate configuration at startup, reporting every problem at once`.

### Task 3: Pool, migrations runner, first migration (app + Limen tables), sqlc scaffold

**Files:**
- Create: `apps/server/internal/db/db.go` (`New(ctx, url) (*pgxpool.Pool, error)`), `apps/server/internal/db/migrate.go`, `apps/server/internal/db/migrations.go` (`//go:embed migrations/*.sql`, `LatestMigrationVersion()`), `apps/server/internal/db/migrations/00001_init.sql`, `apps/server/sqlc.yaml`, `apps/server/generate.go`, `apps/server/internal/db/queries/installation.sql`, `apps/server/internal/db/gen/*` (generated)
- Test: `apps/server/internal/db/migrate_test.go`

**Interfaces:**
- Produces: `db.ApplyMigrations(ctx, databaseURL) error` under advisory lock `MigrationLockKey = 72450002` (fixed forever; comment as Pjokk's); `db.New`; `gen.Queries` with `GetInstallation`, `EnsureInstallation`, `BeginInstallationSetup(staleBefore)`, `CompleteInstallationSetup`, `ResetInstallationSetup`, `RecordRetentionRun`.

- [ ] **Step 1:** Write `00001_init.sql` (goose `Up`/`Down`) with every table in REF §A5 and §B4, indexes and checks included, plus `INSERT INTO app_installation (id, status) VALUES (1, 'pending')`.
- [ ] **Step 2:** Write `migrate.go` as Pjokk's (`sql.Open("pgx")`, single connection, `pg_advisory_lock`, goose provider on embedded FS, unlock).
- [ ] **Step 3:** Failing test: `ApplyMigrations` creates `households` and `users` (`to_regclass`); idempotent second call; the advisory lock blocks a concurrent migrator (hold the lock on another conn, start ApplyMigrations in a goroutine, poll `pg_stat_activity` for a waiting backend, release, assert completion). Test start: `DROP SCHEMA public CASCADE; CREATE SCHEMA public`.
- [ ] **Step 4:** `sqlc.yaml` as Pjokk's (`emit_exact_table_names: true`, `emit_pointers_for_null_types: true`); `generate.go` with `//go:generate sqlc generate` and the two oapi-codegen lines (spec added in Task 6, so add those lines then). Write `installation.sql` queries; `go generate ./...`.
- [ ] **Step 5:** `docker compose -f docker-compose.test.yml up -d && go test -p 1 ./internal/db/` — PASS.
- [ ] **Step 6:** Commit `feat(server): Postgres schema, advisory-lock migrator and sqlc scaffold`.

### Task 4: testrig (Postgres rig)

**Files:**
- Create: `apps/server/internal/testrig/rig.go`
- Test: `apps/server/internal/testrig/rig_test.go`

**Interfaces:**
- Produces: `testrig.DatabaseURL()`, `testrig.Setup(t) *Rig{Pool, Q}` (applies migrations once per process under a mutex, truncates every public table except `goose_db_version`, re-seeds `app_installation` row 1 as pending).

- [ ] **Step 1:** Failing test: two consecutive `Setup` calls see an empty `households` table; `app_installation` row 1 exists with status pending.
- [ ] **Step 2:** Implement as Pjokk's `rig.go` (`ensureMigrated`, `truncateAll`, then `EnsureInstallation`).
- [ ] **Step 3:** `go test -p 1 ./internal/testrig/` — PASS. Commit `test(server): Postgres test rig`.

### Task 5: Health handler, web embed placeholder, server shell, dispatch skeleton

**Files:**
- Create: `apps/server/internal/api/api.go` (`Deps`, `NewHandler`), `apps/server/internal/api/respond/respond.go` (`JSON`, `Error(w, status, msg)`, `ErrorFields`, `ErrorCode`), `apps/server/internal/api/system.go` (`/healthz`, `/readyz`), `apps/server/internal/web/web.go`, `apps/server/internal/web/dist/index.html` (placeholder `<!doctype html><title>Mi Casa Su Casa</title><p>SPA build missing — run scripts/build-artifacts.sh</p>`), `apps/server/cmd/mi-casa/main.go` (full dispatch table: default/server/worker/migrate/cron/healthcheck; cron and worker wired in P7 — until then `cron` prints usage and exits 2)
- Test: `apps/server/internal/api/system_test.go`, `apps/server/internal/web/web_test.go`, `apps/server/cmd/mi-casa/main_test.go` (parseArgs table)

**Interfaces:**
- Produces: `api.Deps{Pool, Q, Now func() time.Time, AppURL, AppName, EmailDomain, TrustedProxyHops int, IPDigest func(string) string, …}` (fields added by later tasks), `api.NewHandler(deps) http.Handler` (mux: `/healthz`, `/readyz`, JSON 404 for other `/api/*`), `web.Handler(api http.Handler) http.Handler` (SPA fallback + security headers from REF §A1; probe paths and `/api/` bypass), `respond.Error`.

- [ ] **Step 1:** Failing tests: `GET /healthz` → 200 `{"ok":true}` without touching the pool (nil pool); `GET /readyz` → 200 `{ok:true,status:"ready",setupConfigured:true,retention:{lastRunAt:null,stale:true}}`, → 503 `{ok:false,error}` with a closed pool; `GET /api/nope` → 404 `{"error":"Not found"}` JSON; web: `/` and `/casa/inbox` serve `text/html` with the CSP, HSTS, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options`; `/healthz` has no CSP; `/robots.txt` → `Disallow: /`; hashed asset path gets `Cache-Control: public, max-age=31536000, immutable`, `index.html` gets `no-cache`.
- [ ] **Step 2:** Implement `respond`, `system.go` (readiness reads `GetInstallation` for `last_retention_run_at`, stale when null or older than 48 h per REF §A2), `web.go` (Pjokk's shape, headers from REF §A1), `main.go` (Pjokk's `run`/`parseArgs`/`serveMode`/`healthcheckMode`/`migrateMode`/`serveUntilSignal`; `_ "time/tzdata"`).
- [ ] **Step 3:** Tests PASS; `go run ./cmd/mi-casa migrate` against the compose DB applies; `go run ./cmd/mi-casa` serves `/healthz`.
- [ ] **Step 4:** Commit `feat(server): health probes, embedded SPA shell and dispatch modes`.

### Task 6: OpenAPI skeleton and codegen wiring

**Files:**
- Create: `openapi/mi-casa.yaml` (info, `/healthz`, `/readyz`, `components.schemas.Error {error, fields?, code?}`), `apps/server/internal/api/gen/cfg-types.yaml`, `cfg-server.yaml`, generated `types.gen.go`, `server.gen.go`, `apps/server/internal/api/mi-casa.yaml` (copy), `apps/server/internal/api/spec_sync_test.go`
- Modify: `apps/server/generate.go`, `apps/server/internal/api/api.go` (load embedded spec, mount strict handlers, kin-openapi request validator with `ExcludeRequestBody:false`, JSON error shape via `ErrorHandler` producing REF §A1 validation envelope)

- [ ] **Step 1:** Failing test `spec_sync_test.go`: embedded copy equals `../../../openapi/mi-casa.yaml` byte for byte; generated files are up to date (run `oapi-codegen` into a temp dir and diff) — skip when the binary is absent with `t.Skip` **only** outside CI (`CI` env set → hard fail).
- [ ] **Step 2:** Write the spec skeleton, `generate.go`, run `go generate ./...`; move `/healthz` `/readyz` onto the strict server.
- [ ] **Step 3:** Tests PASS. Commit `feat(server): OpenAPI spec as source of truth with committed codegen`.

### Task 7: test.yml workflow and root scripts

**Files:**
- Create: `.github/workflows/test.yml` (reusable; Pjokk's with `micasa` Postgres creds on port 5432 and `TEST_DATABASE_URL=postgres://micasa:micasa@127.0.0.1:5432/micasa_test`; steps: mise-action `go bun`, Go cache, `bun install --frozen-lockfile`, `bun run check`, `goreleaser check` (added in P9 — add the step then), `bun run test`, `go vet`, `go test -p 1`), `.github/workflows/go-ci.yml` (`on: pull_request` calling `test.yml`; renamed to `ci-go.yml` and extended in P9)
- Modify: root `package.json`: add `"workspaces": ["apps/frontend"]` (folder created in P8; until then keep the array empty), scripts `check` (`biome check .` + `tsc --noEmit`), keep every existing npm script working. Add `bun.lock` by running `bun install`.

- [ ] **Step 1:** `bun install` produces `bun.lock`; `bun run check` and `npm run ci` both pass locally.
- [ ] **Step 2:** Commit `ci: run the Go suite against Postgres on every pull request`.
- [ ] **Step 3:** Open issue "P1: Go toolchain, config, health and test workflow", branch `go/p1-skeleton`, PR, wait for both `CI` and the new workflow, squash-merge.

---

## Phase P2 — Domain ports and repositories

### Task 8: Pure domain ports with the TS test cases

**Files:**
- Create: `apps/server/internal/domain/slug.go`, `slug_test.go`; `internal/domain/extract.go`, `extract_test.go`; `internal/domain/verdict.go` (`Authentication{SPF, DKIM, DMARC *string}`, `Verdict(auth *Authentication, source Source) (trusted bool, reason string)`), `verdict_test.go`; `internal/mail/html.go` (`StripHTML`, `DecodeEntities`), `html_test.go`; `internal/mail/authresults.go` (`ParseAuthenticationResults([]string) *domain.Authentication`), `authresults_test.go`; `internal/security/compare.go` (`SecretsEqual(a, b string) bool` via SHA-256 + `subtle.ConstantTimeCompare`), `compare_test.go`; `internal/security/tokens.go` (`NewInvitationToken() (token, hash string)`, `HashInvitationToken`), `tokens_test.go`; `internal/security/ip.go` (`ClientIP(xff, remote string, hops int)`, `Digest(secret) func(ip string) string`), `ip_test.go`

- [ ] **Step 1:** Port each test file's cases: `test/household-slug.test.ts`, `test/extract-code.test.ts` (table in REF §A3, all 19 rows + the `stripHtml` case), `test/classify-email.test.ts` verdict cases (`dmarc=fail` untrusted; header source with dkim pass trusted; header without → reason text; envelope with spf pass; envelope without → reason; nil auth trusted), `test/parse-email.test.ts` `parseAuthenticationResults` cases, `test/secrets-compare.test.ts`, Pjokk's `ratelimit_test.go` ClientIP cases (0 hops → socket; 1 hop → last XFF entry; 2 hops → second-last; empty → "unknown").
- [ ] **Step 2:** FAIL, implement each file (REF §A3 rules verbatim; the lookbehind split as a rune loop), PASS.
- [ ] **Step 3:** Commit `feat(server): port slug, code extraction, sender verdict and security helpers`.

### Task 9: sqlc queries and repositories

**Files:**
- Create: `apps/server/internal/db/queries/{users,households,memberships,providers,sender_rules,messages,quarantine,invitations,audit,ratelimit,sessions}.sql`, regenerate `internal/db/gen`
- Create: `apps/server/internal/repo/repo.go` (`type Repo struct{ pool, q }`, `InTx(ctx, fn)`), `households.go`, `providers.go`, `messages.go`, `invitations.go`, `audit.go`, `ratelimit.go` — thin Go wrappers only where a repository function in `src/server/db/repositories/*.ts` did more than one statement (createHousehold, acceptInvitation, reviewQuarantine release, createInvitation with providers, purge loop, grant/revoke access)
- Test: `apps/server/internal/repo/*_test.go` using `testrig.Setup`

**Interfaces (produces, exact names later tasks call):**
- `repo.ListHouseholdsForUser(ctx, userID) ([]HouseholdSummary, error)`; `GetHouseholdBySlug`, `GetHouseholdByID`, `CreateHousehold(ctx, slug, displayName, ownerUserID) (Household, error)` (tx: household + owner membership), `UpdateHouseholdDisplayName`, `MembershipForSlug(ctx, userID, slug) (*Membership{HouseholdID, Slug, Role}, error)`, `GetMembership(ctx, userID, householdID)`, `CountOwners`, `RemoveMember`, `SetMemberRole`, `ProvidersBelong(ctx, householdID, ids []string) (bool, error)`.
- `repo.ListProviderConfigurations`, `ListSenderRules`, `GetProviderByKey`, `GetProviderByID`, `CreateProvider`, `UpdateProvider`, `DeleteProvider`, `CreateSenderRule`, `UpdateSenderRule`, `DeleteSenderRule`, `GetSenderRuleByID`, `FindProviderMatch(ctx, householdID, candidates []Candidate) (*Match, error)` (exact then domain, REF §A3), `UserHasProviderAccess`, `ListMembers`, `ListMemberProviderAccess`, `ListProviders`, `GrantProviderAccess`, `RevokeProviderAccess`.
- `repo.InsertMessage(ctx, parsed, householdID, providerID, code, reason, now) (id string, err)` (ON CONFLICT DO NOTHING), `InsertQuarantine`, `ListMessagesForProvider(ctx, householdID, key, Page) (Page[InboxMessage])`, `ListProviderSummariesForUser`, `CountUnreviewedQuarantine`, `ListQuarantine`, `UpdateMessageStatus`, `FindMessageByID`, `ReviewQuarantine(ctx, householdID, id, action, providerID) (*Review, error)`, `PurgeExpired(ctx, now, batch) (PurgeResult, error)`, `NormalizePage(limit int, before string) Page`.
- `repo.CreateInvitation(ctx, in) (id, err)`, `ListInvitations`, `GetInvitationByTokenHash`, `GetInvitationByID`, `CancelInvitation`, `AcceptInvitation(ctx, in)`, `RefreshExpiredInvitations(ctx, now, householdID *string)`, `IsInvitationExpired`.
- `repo.RecordAudit(ctx, in)` (never returns an error to callers; logs), `ListAuditEvents(ctx, householdID, limit)`.
- `repo.FindUserByEmail`, `FindUserByID`, `DeleteUser`, `GetUserProfile`, `UpdateUserProfile`, `ListUserSessions`, `DeleteSession`, `DeleteOtherSessions`.
- `repo.RateLimitHit(ctx, key, windowSeconds) (count int, err)`, `RateLimitSweep`.

- [ ] **Step 1:** For each repository test in `test/integration/*repository*.test.ts`, `provider-rules.test.ts`, `pagination.test.ts`, `invitation-expiry.test.ts`, `retention.test.ts`, `tenant-isolation.test.ts` write the Go counterpart against the rig first (same scenarios: pagination cursor; duplicate message swallowed; domain rule matches subdomain and longest wins; exact beats domain; purge batches; expired invitations flip status; access rows cascade on membership delete; a household never sees another's rows).
- [ ] **Step 2:** Write SQL, `go generate`, implement wrappers, PASS.
- [ ] **Step 3:** Commit `feat(server): sqlc queries and household-scoped repositories`. Issue "P2: domain ports and repositories", PR, merge.

---

## Phase P3 — Auth (Limen), setup, invitations

### Task 10: Limen service

**Files:**
- Create: `apps/server/internal/auth/auth.go`, `core_plugin.go` (Pjokk's), `session.go`
- Test: `apps/server/internal/auth/auth_test.go` (rig-backed)

**Interfaces:**
- Produces: `auth.Config{AppURL, AppName, Secret string; Pool; SendPasswordReset func(ctx, to, name, url string) error}`, `auth.New(cfg) (Service, error)`, `type Session struct{ UserID, Email, Name, Token string; TwoFactorEnabled bool; SessionID string }`, `Service` interface: `Handler() http.Handler`, `SessionFromRequest(r) (*Session, error)` (nil,nil when none), `CreateUser(ctx, name, email, password) (userID string, err)`, `SignIn(ctx, w, r, userID string) error` (sets cookie via core.CreateSession), `RevokeAllSessions`, `RevokeSession(ctx, token)`, `DeleteUser(ctx, userID)`, `HashedIPDigest func(string) string`.
- Produces: `auth.BasePath = "/api/auth"`, `auth.CookieName = "mi_casa_session"`.

- [ ] **Step 1:** Failing tests through Limen's HTTP handler mounted in a test mux: `POST /api/auth/signup/credential` → 404 (disabled); `CreateUser` then `POST /signin/credential` `{credential, password}` → 200 with `Set-Cookie mi_casa_session`; `GET /me` with the cookie → 200 containing the email; wrong password → 401; short password on `CreateUser` → error; `POST /passwords/request-reset` calls `SendPasswordReset` with a URL `APP_URL/reset-password?token=…` and the user's name; `POST /passwords/reset` with that token → subsequent sign-in with the new password works and the old session is revoked; two-factor: `initiate-setup` → `{uri}`, generate a TOTP from the secret in the URI (use `github.com/pquerna/otp/totp` in tests), `finalize-setup` → user `two_factor_enabled`; sign-in now returns `{"two_factor_required":true}` and no session cookie; `/two-factor/verify` `{code}` → cookie; `GET /backup-codes` → 10 codes; verify with a backup code works once; `disable` with password → sign-in issues a cookie directly. Session metadata stores an IP digest, never `127.0.0.1`.
- [ ] **Step 2:** Implement per REF §B1–B3 (copy Pjokk's `auth.go` structure; `disabledRouteIDs` from REF §B3).
- [ ] **Step 3:** PASS. Commit `feat(server): Limen-backed auth with password, reset and two-factor`.

### Task 11: Middleware chain, rate limiter, request logging

**Files:**
- Create: `apps/server/internal/api/middleware/middleware.go` (`Session(d)`, `RequireSession`, `RequireHousehold(d)` (slug from path), `RequireOwner`, `SameSite(appURL)`, `LogFailures`, `RateLimit(store, rule, ipFn)`), `apps/server/internal/ratelimit/ratelimit.go` (Pjokk's `Store` + `Postgres` + rules `Setup{5,15m}`, `Invitations{20,10m}`, `HouseholdCreate{10,1h}`), `apps/server/internal/log/log.go` (`Event(level, event string, fields map[string]any)` JSON line via `log/slog`)
- Test: `middleware_test.go`, `ratelimit_test.go`

**Interfaces:**
- Produces: `middleware.UserFrom(r) *auth.Session`, `middleware.HouseholdFrom(r) Household{ID, Slug, Role}`, `middleware.ClientKey(r) string` (digest).

- [ ] **Step 1:** Failing tests from `test/origin-policy.test.ts` (each same-site rule in REF §A1, including Referer-only and `Sec-Fetch-Site: cross-site` with matching Origin allowed), `test/integration/rate-limit.test.ts` (6th setup call in 15 min → 429 with `Retry-After`), `request-logging.test.ts` (a 404 produces one `api_request_failed` line with method, path, status, durationMs; a 200 produces none), household guards (non-member 403, member ok, owner-only 403 for member).
- [ ] **Step 2:** Implement; PASS. Commit `feat(server): session, tenancy, same-site and rate-limit middleware`.

### Task 12: HTTP test rig, setup and invitation routes

**Files:**
- Create: `apps/server/internal/testrig/http.go` (`testrig.App(t) *AppRig{Rig, Deps, Handler, Mail *RecordingSender}`, `Do(method, path, body, opts...)`, `SignIn(email) cookie`, `CreateOwner()` (completes setup), `CreateMember(...)`)
- Create: `apps/server/internal/api/setup.go`, `invitations_public.go`, `apps/server/internal/mail/sender.go` (`Sender` interface `Send(ctx, Message) error`; `RecordingSender`), `internal/mail/templates.go` (`PasswordReset(to, name, url) Message`, `Invitation(in) Message` — REF §A3 outbound texts)
- Modify: `openapi/mi-casa.yaml` (setup and invitations paths with schemas from REF §A4), regenerate
- Test: `setup_test.go`, `invitations_public_test.go`, `templates_test.go`

- [ ] **Step 1:** Port `test/integration/setup-route.test.ts`, `setup-recovery.test.ts`, `invitation-accept.test.ts`, `invitation-service.test.ts` (every status and message in REF §A2 setup/invitations rows; the cookie is set on 201; orphan owner cleanup; in-progress reclaim after 10 minutes using `Deps.Now`; signed-in mismatch 403; `ACCOUNT_EXISTS` 409; expired 410; token in header only — a query-string token is ignored).
- [ ] **Step 2:** Implement; PASS. Commit `feat(server): first-run setup and invitation acceptance`. Issue "P3: Limen auth, setup, invitations", PR, merge.

---

## Phase P4 — Households, admin, settings

### Task 13: Households and settings routes

**Files:** `apps/server/internal/api/households.go`, `settings.go`; spec paths; tests porting `household-creation.test.ts`, `membership-removal.test.ts` (leave), `settings-route.test.ts`, `two-factor.test.ts` (profile shows `twoFactorEnabled`), `auth.test.ts` (sessions list, revoke one, revoke others → the other cookie stops working).

- [ ] Steps: failing tests → implement per REF §A2 → PASS → commit `feat(server): households and account settings routes`.

### Task 14: Admin routes (providers, rules, members, invitations, settings, audit)

**Files:** `apps/server/internal/api/admin_providers.go`, `admin_members.go`, `admin_invitations.go`, `admin_settings.go`, `internal/domain/invite.go` (`InviteMember`, `ResendInvitation` per REF §A3 with `mail.Sender`); spec paths; tests porting `provider-rules.test.ts`, `provider-summaries.test.ts`, `invitations-repository.test.ts` (route level), `audit-log.test.ts` (each action in REF §A6 recorded with actor and household), `membership-removal.test.ts` (last owner 409, self 400), `error-handling.test.ts` (duplicate rule → 409 with the column message; invalid JSON → 400 `"Invalid JSON body"`; field errors envelope), `tenant-isolation.test.ts` (owner of A cannot read/modify B by id).

- [ ] Steps: tests → implement → PASS → commit `feat(server): owner administration routes`. Issue "P4: households, admin and settings", PR, merge.

---

## Phase P5 — Inbox and quarantine

### Task 15: Inbox routes

**Files:** `apps/server/internal/api/inbox.go`; spec; tests porting `inbox-routes.test.ts`, `pagination.test.ts` (route level), `messages-repository.test.ts` (release path), `security-headers.test.ts` (API responses carry `X-Content-Type-Options` and no CSP is required; SPA has CSP).

- [ ] Steps as above; commit `feat(server): inbox and quarantine routes`. Issue "P5: inbox", PR, merge.

---

## Phase P6 — Mail: Mailgun inbound, MIME parsing, SMTP outbound

### Task 16: MIME parsing and classification

**Files:**
- Create: `apps/server/internal/mail/parse.go` (`Parse(raw []byte, envelopeFrom, envelopeTo string) (*Parsed, error)` using `github.com/emersion/go-message/mail`; REF §A3 email parsing incl. synthetic Message-ID, truncation, HTML fallback, Mailgun headers → authentication), `internal/domain/classify.go` (`Classify(ctx, repo, parsed) (Classification, error)`)
- Test: `parse_test.go` (port `test/parse-email.test.ts` fully: html fallback, empty body placeholder, truncation flag, synthetic id determinism, `Authentication-Results` parsing, `X-Mailgun-Spf: Pass` → `spf=pass`, multipart alternative prefers text, quoted-printable and base64 bodies decode, charset ISO-8859-1 decodes), `classify_test.go` (port `test/classify-email.test.ts` against the rig)

- [ ] Steps: tests → implement → PASS → commit `feat(server): parse inbound MIME and classify against sender rules`.

### Task 17: Mailgun webhook handler and SMTP sender

**Files:**
- Create: `apps/server/internal/mail/mailgun.go` (`VerifySignature(key, timestamp, token, signature string, now time.Time) error`, replay set), `apps/server/internal/api/inbound.go` (handler per REF §A3 inbound + Part C; mounted outside the OpenAPI strict server, before the same-site middleware), `apps/server/internal/mail/smtp.go` (`NewSMTPSender(smtpURL, from string) (Sender, error)` using `net/smtp` with STARTTLS for `smtp://`, implicit TLS for `smtps://`, PLAIN auth from the URL userinfo, RFC 5322 message with text and HTML alternative parts)
- Modify: `cmd/mi-casa/main.go` (build the SMTP sender and the webhook key into `Deps`)
- Test: `mailgun_test.go` (valid signature accepted; wrong key 401; stale timestamp 401; replayed token 401), `inbound_test.go` (rig: matched → 200 stored + row in `messages` with code; unmatched → 200 quarantined; unknown recipient → 406; > 2 MiB → 406; quarantine full (seed 200 rows) → 406; unparseable → 406; missing `body-mime` → 406; Mailgun SPF fail on an envelope match → quarantined with the verdict reason), `smtp_test.go` (start an in-process SMTP server on a random port using `github.com/emersion/go-smtp`'s backend in the test, assert the received DATA contains the subject and both parts; STARTTLS negotiation with a self-signed cert)

- [ ] Steps: tests → implement → PASS → commit `feat(server): Mailgun inbound webhook and SMTP outbound mail`. Issue "P6: mail", PR, merge.

---

## Phase P7 — Retention job, cron, dispatch modes

### Task 18: Jobs and scheduler

**Files:** `apps/server/internal/jobs/retention.go` (`Run(ctx, Deps, now) (Result, error)` per REF §A3), `internal/cron/cron.go` (Pjokk's shape; `Jobs = ["retention"]`, schedule `0 3 * * *`, UTC, `StartScheduler(deps) stop func`, also sweeps `rate_limit` and Limen `rate_limits` expired rows), `cmd/mi-casa/main.go` (`cron <job>`, `worker`, default mode starts the scheduler)
- Test: port `retention.test.ts` (expired message and quarantine rows purged in batches, unexpired kept, pending invitation past expiry flips, `last_retention_run_at` recorded, `/readyz` reports `stale:false` afterwards); `cron_test.go` (unknown job error; schedule parses; scheduler location is UTC).

- [ ] Steps: tests → implement → PASS → commit `feat(server): retention job, UTC scheduler and worker/cron modes`. Issue "P7: jobs and dispatch", PR, merge.

---

## Phase P8 — Frontend: move, TanStack Router, Limen client, typed API

### Task 19: Move `src/client` to `apps/frontend` (mechanical)

**Files:**
- Move: `src/client/**` → `apps/frontend/src/**`, `src/client/index.html` → `apps/frontend/index.html`, `src/client/public` → `apps/frontend/public`; client tests `test/*.test.tsx`, `test/client-utils.test.ts`, `test/theme.test.ts`, `test/pwa-manifest.test.ts`, `test/client-test-utils.tsx`, `test/ui-primitives.test.tsx` → `apps/frontend/test/`
- Create: `apps/frontend/package.json` (`@mi-casa/frontend`, scripts `dev`, `build`, `test` (vitest), `typecheck`), `apps/frontend/vite.config.ts` (outDir `../../dist/client`, alias `@` → `src`, dev proxy `/api`, `/healthz`, `/readyz` → `http://localhost:3000`), `apps/frontend/vitest.config.ts` (jsdom project), `apps/frontend/tsconfig.json`
- Modify: root `package.json` workspaces `["apps/frontend"]`; root `vite.config.ts`/`vitest.config.ts` keep building the Workers app from `apps/frontend` (alias `@client` → `apps/frontend/src`) so `npm run build` and the Cloudflare deploy keep working until P12; `src/client` import of `@server/auth/client` becomes a path alias resolvable from both configs.

- [ ] **Step 1:** `git mv`; update imports; `bun run --filter @mi-casa/frontend test`, `bun run typecheck`, `npm run ci` all pass.
- [ ] **Step 2:** Commit `refactor(client): move the SPA to apps/frontend`.

### Task 20: TanStack Router

**Files:**
- Create: `apps/frontend/src/router.tsx` (code-based routes per spec §Frontend: root with providers, public routes, authed `/settings`, `/new-household`, `/$slug` shell with children `inbox`, `inbox/$providerKey`, `quarantine`, `members`, `providers`, `settings`; `/` redirect), `apps/frontend/src/lib/guards.ts` (`beforeLoad` helpers: `requireSession`, `requireSetupDone`, `requireHousehold(slug)`, `requireOwner`), `apps/frontend/src/lib/session.ts` (query options for `/api/setup/status`, `/api/settings/households`)
- Modify: `main.tsx` (RouterProvider), `App.tsx` (deleted; its state moves to the shell route and guards), `Layout.tsx`, `InboxPage.tsx`, `ServiceList.tsx`, `NeedsReviewPage.tsx`, `InvitePage.tsx`, `LoginPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `TwoFactorPage.tsx` (`Link`/`useNavigate`/`useParams`/`useSearchParams` → `@tanstack/react-router`), `test/client-test-utils.tsx` (render inside a memory-history router with a catch-all route), the four tests that use `MemoryRouter`
- Remove: `react-router-dom` dependency

- [ ] **Step 1:** Update `layout.test.tsx`, `inbox-page.test.tsx`, `password-reset-pages.test.tsx`, `two-factor-page.test.tsx` to the new test utils; add `router.test.tsx`: unauthenticated `/casa/inbox` redirects to `/login`; `needsSetup` redirects to `/setup`; member visiting `/casa/members` redirects to `/casa/inbox`; `/` with one household → `/casa/inbox`; `/` with none → `/new-household`.
- [ ] **Step 2:** FAIL → implement → PASS; `bun run build` succeeds; manual check with the screenshot harness (memory `mi-casa-screenshot-harness`) that inbox, members and settings render.
- [ ] **Step 3:** Commit `feat(client): TanStack Router with route guards`.

### Task 21: Limen auth client and typed API client

**Files:**
- Create: `apps/frontend/src/lib/auth-client.ts` (REF §B5), `apps/frontend/src/lib/api.ts` (openapi-fetch client + `unwrap` as Pjokk's), `apps/frontend/src/lib/api-schema.d.ts` (generated; root script `gen:client` as Pjokk's `bunx --package openapi-typescript@7.13.0 …`)
- Modify: every `queries/*.ts` (`fetchJson` → `unwrap(client.GET(...))`), `utils.ts` (remove `fetchJson`, keep helpers), `LoginPage.tsx` (email + password only; `two_factor_required` → navigate `/two-factor`; passkey autofill removed), `TwoFactorPage.tsx` (`twoFactor.verify`), `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `settings/PasswordSection.tsx`, `settings/TwoStepSection.tsx` (initiate → QR from `uri` → finalize → show backup codes from `getBackupCodes`), `settings/AccountSettingsPage.tsx` (drop `PasskeysSection`), `DevicesSection.tsx` (`ipAddress` shown as "hidden"), `types.ts` (`SessionData` from Limen shape), tests mocking `@server/auth/client` → mock `@/lib/auth-client`
- Remove: `src/server/auth/client.ts` import from the client, `PasskeysSection.tsx`, `better-auth` client usage, `qrcode` stays
- Delete dependency: `@better-auth/passkey` from the frontend workspace (root keeps it for the Workers app until P12)

- [ ] **Step 1:** Update tests (`login-page.test.tsx`: no passkey button; 2FA redirect on `two_factor_required`; `two-factor-page.test.tsx`; `account-settings-page.test.tsx`: no passkeys section, two-step enrolment flow shows QR then backup codes) → FAIL → implement → PASS.
- [ ] **Step 2:** Add `apps/frontend/test/api-client.test.ts`: `unwrap` throws `ApiError` with the server's `error` message and `code`.
- [ ] **Step 3:** Commit `feat(client): Limen auth client and OpenAPI-typed API client; passkeys removed`. Issue "P8: frontend on TanStack Router, Limen and openapi-fetch", PR, merge.

---

## Phase P9 — Build, image, CI image job, release

### Task 22: Artifact scripts and Dockerfile

**Files:** `scripts/spa-embed-overlay.sh`, `scripts/restore-embed-overlay.sh`, `scripts/build-artifacts.sh`, `scripts/build-image.sh` (Pjokk's, single embed dir `apps/server/internal/web/dist`, binary `mi-casa`), `Dockerfile` (Pjokk's minus `/data`; `COPY ${BINARY_ROOT}/${TARGETPLATFORM}/mi-casa /app/mi-casa`, HEALTHCHECK `["/app/mi-casa","healthcheck"]`), `.dockerignore`, `docker-compose.yml` (build from source: `postgres:17-alpine` + app built via `scripts/build-artifacts.sh` then `docker build`), `docker-compose.selfhost.yml` (Pjokk's shape with `DATABASE_URL`, `APP_URL`, `AUTH_SECRET`, `SETUP_SECRET`, `OWNER_EMAIL`, `EMAIL_DOMAIN`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `SMTP_URL`, `OUTBOUND_EMAIL_FROM`, `TRUSTED_PROXY_HOPS`; no data volume).

- [ ] **Step 1:** `mise run artifacts` produces both binaries with the real SPA embedded (`strings dist/server/linux/amd64/mi-casa | grep -c 'id="root"'` ≥ 1) and leaves `git status` clean.
- [ ] **Step 2:** `docker build -t mi-casa:dev .` then run against the compose DB; `curl /readyz` ok; `curl /` returns the SPA; image size under 40 MB (`docker images mi-casa:dev`).
- [ ] **Step 3:** Commit `build: native artifacts, COPY-only distroless image and compose files`.

### Task 23: CI image job and GoReleaser release

**Files:** `.github/workflows/ci-go.yml` (Pjokk's `ci.yml`: test → build artifacts → build image → smoke test (migrate, serve, `/readyz`, `/` is HTML, webhook bad signature → 401) → push `<next>-pr.<N>` and `<next>-pr.<N>.<sha>` to `ghcr.io/andersro93/mi-casa-su-casa` when not a fork), `.github/workflows/release.yml` (Pjokk's verbatim with names changed; environment `production` url from a repo variable), `.goreleaser.yaml` (Pjokk's with one before hook, `dockers_v2` image `ghcr.io/andersro93/mi-casa-su-casa`, no `extra_files`), `test.yml` gains `goreleaser check`.

- [ ] **Step 1:** `goreleaser check` passes; `mise run snapshot` builds archives and a local image.
- [ ] **Step 2:** Commit `ci: image smoke test with PR preview images, and merging-is-releasing via GoReleaser`. Issue "P9: build, image, release", PR (the image job runs on this PR itself), merge. The merge triggers `release.yml`; verify `v0.1.0` appears with a signed image.

---

## Phase P10 — Playwright end-to-end suite

### Task 24: E2E stack and suite

**Files:**
- Create: `scripts/e2e-stack.sh` (Pjokk's plus a `axllent/mailpit` container; app env: `SMTP_URL=smtp://mailpit:1025`, `OUTBOUND_EMAIL_FROM=noreply@e2e.test`, `EMAIL_DOMAIN=e2e.test`, `MAILGUN_WEBHOOK_SIGNING_KEY=e2e-signing-key`, `OWNER_EMAIL=owner@e2e.test`, `SETUP_SECRET=e2e-setup-secret`, `ENVIRONMENT=test`, `APP_URL=http://127.0.0.1:3300`; publishes Mailpit's API on 8025), `e2e/playwright.config.ts` (Pjokk's; `workers: 1`, mobile Chromium profile plus one desktop project for the inbox layout), `e2e/tsconfig.json`, `e2e/helpers.ts` (`completeSetup(request)`, `signIn(page, email, password)`, `mailpit.lastMessageTo(email)` + link extraction, `postInbound(request, {to, from, subject, text, spf})` building a signed Mailgun form with `body-mime`, `totpFrom(uri)` using `otpauth`), `e2e/fixtures.ts`
- Specs: `setup.spec.ts` (first run: `/` redirects to `/setup`, wrong secret rejected, success lands in the inbox, `/setup` locked after), `auth.spec.ts` (sign-in, wrong password, sign-out, session revocation from account settings), `two-factor.spec.ts` (enrol with QR URI → TOTP, backup codes shown, sign-in challenged, TOTP accepted, backup code accepted once, disable), `password-reset.spec.ts` (request → Mailpit link → new password works → old session gone), `invite.spec.ts` (invite by email → Mailpit link → create account → member sees only scoped services; invite by link copy; resend; cancel), `services.spec.ts` (create service + exact and domain senders, rename, delete), `inbox.spec.ts` (post inbound mail → code visible with copy button → mark used; SPF fail lands in Needs review), `quarantine.spec.ts` (release to a service, dismiss), `members.spec.ts` (grant/revoke access, promote, remove; last owner cannot leave), `household.spec.ts` (rename, copyable address `slug@e2e.test`, create second household as owner).
- Modify: root `package.json` devDependency `@playwright/test`, `otpauth`; `typecheck` includes `tsc --noEmit -p e2e`; `ci-go.yml` adds `bunx playwright install --with-deps chromium` and `cd e2e && bunx playwright test` after the smoke test with the report uploaded on failure (the stack in CI reuses the smoke-test image and adds Mailpit).

- [ ] **Step 1:** Write the helpers and the setup spec first; `mise run e2e` green.
- [ ] **Step 2:** Add the remaining specs one by one, each green locally.
- [ ] **Step 3:** Commit `test(e2e): Playwright suite against the real image with Mailpit`. Issue "P10: end-to-end tests", PR (CI runs the suite), merge.

---

## Phase P11 — README and docs

### Task 25: README rewrite and operator docs

**Files:** `README.md` (spec §README; structure and tone of Pjokk's README: badges, logo, pitch, screenshots, "Run it" quick start, Self-hosting guide with the env table from spec §config, image tags and pinning ladder, reverse proxy, Mailgun receiving setup, SMTP, first-run setup, upgrades, backups, verifying signatures with `cosign verify-blob --bundle` and `cosign verify`, Development section (`mise install`, `bun install`, compose test DB, `mise run test`, `mise run e2e`, `mise run artifacts`, `mise run image`, `mise run snapshot`), Release model, Architecture at a glance, Contributing, Licence), `docs/email-routing.md` → `docs/inbound-mail.md` (Mailgun: receiving domain, MX records, route, signing key, testing with curl, troubleshooting), `docs/operations.md` (container logs, health, alerts), `docs/runbook.md` (roll back by image tag, Postgres backup/restore with `pg_dump`, migrations, lost owner, rotate secrets, inbound mail stopped), `docs/ci-cd-architecture.md` (replace with the new pipeline), `CONTRIBUTING.md` (commands), `SECURITY.md` (new, as Pjokk's), `DECISIONS.md` (new: record the decisions listed in the spec table plus those made during implementation), `.github/dependabot.yml` (gomod, npm, github-actions, docker).

Keep the Cloudflare sections in the README under a clearly marked "Legacy Cloudflare deployment (removed in the next release)" heading until P12 removes them.

- [ ] Steps: write → `bun run check` (Biome also formats Markdown? no — leave) → commit `docs: self-hosting guide, operations and runbook for the container`. Issue "P11: docs", PR, merge.

---

## Phase P12 — Cutover

### Task 26: Remove the Workers app

**Files:**
- Delete: `src/`, `wrangler.jsonc`, `migrations/`, `drizzle.config.ts`, `requests/`, root `vite.config.ts`, root `vitest.config.ts`, `test/` (server tests already ported; integration tests superseded), `.github/workflows/ci.yml`, `preview-deploy.yml`, `production-deploy.yml`, `production-d1-migrate.yml`, `docs/ci-cd-architecture.md` legacy parts, `.dev.vars.example`
- Modify: root `package.json` (drop Workers deps: `hono`, `better-auth`, `@better-auth/*`, `drizzle-*`, `postal-mime`, `wrangler`, `@cloudflare/*`; scripts reduced to `dev`, `dev:server`, `build`, `check`, `test`, `typecheck`, `gen:client`), rename `ci-go.yml` → `ci.yml`, `README.md` (drop the legacy section, description "Self-hosted shared verification inbox for families"), `package.json` description, `codeql-analysis.yml` languages `go, javascript-typescript`.

- [ ] **Step 1:** `mise run check && mise run test && mise run artifacts && mise run e2e` green.
- [ ] **Step 2:** Commit `chore!: remove the Cloudflare Workers backend` (breaking change → minor bump under `--v0`). Issue "P12: cutover", PR, merge. Confirm the release publishes.
- [ ] **Step 3:** Update memory `mi-casa-delivery-flow` (tests now `mise run test`, e2e `mise run e2e`) and `mi-casa-ux-redesign-status` (router is now TanStack).

---

## Self-review notes

- Spec coverage: every spec section maps to a phase: architecture/layout (P1), config/db (P1–P2), auth (P3), api (P3–P5), mail (P6), jobs/cron/web (P7, P1), frontend (P8), build/release/self-host (P9), e2e (P10), README/docs (P11), cutover (P12).
- Names used across tasks: `api.Deps`, `api.NewHandler`, `web.Handler`, `testrig.Setup`, `testrig.App`, `auth.Service`, `mail.Sender`, `repo.*` as listed in Task 9, `ratelimit.Store`, `middleware.*` as listed in Task 11, `jobs.Run`, `cron.StartScheduler`.
