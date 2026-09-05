# DECISIONS

Choices made while building this, that the README does not cover. Boring
decisions, written down so they can be revisited deliberately rather than
rediscovered by archaeology.

Newest sections last. If you make a call in a pull request — a library, a
trade-off, an accepted limitation — add a line here in the same PR.

## The migration off Cloudflare

The backend moved from a Cloudflare Worker to a single static Go binary in a
container. These were settled before any code was written:

- **Inbound mail arrives as a webhook, not over SMTP.** Running an SMTP
  listener means MX records pointed at *us*, TLS certificates for the mail
  host, spam handling and a queue. A provider that already does all of that and
  posts us the finished message is a smaller thing to operate and a smaller
  thing to get wrong.
- **The provider is Mailgun**, through routes. One route
  (`match_recipient(".*@EMAIL_DOMAIN")`) covers every household, because the
  app resolves the household from the recipient's local part itself.
- **The database is Postgres** — pgx, sqlc for typed Go from plain SQL, goose
  for migrations. D1/SQLite went with the Worker.
- **Auth is [Limen](https://github.com/thecodearcher/limen)**, replacing Better
  Auth. **Passkeys are dropped** for now: Limen has no WebAuthn plugin, and a
  hand-rolled one is not a migration-sized piece of work. They return as a
  follow-up.
- **The frontend keeps MUI and the redesigned screens.** Only the router and
  the client layers change (React Router → TanStack Router, Better Auth client
  → `limen-auth`, hand-written fetch → `openapi-fetch` against generated
  types). This was a backend migration, not a redesign.
- **No data migration.** The container starts empty and `/setup` runs again.
  Importing D1 rows into Postgres would have cost more than the households in
  existence are worth, and password hashes do not carry over regardless.
- **Landing incrementally on `main`.** The Go code grew beside `src/` rather
  than on a long-lived branch, so every pull request left `main` deployable on
  Cloudflare, and the Worker kept working until a single cutover release
  removed it — see "The cutover" below.

## Process

- **One phase, one branch, one pull request.** Phases that could not wait for
  the previous one's review ran in a **git worktree** with their own test
  database, then rebased onto `main` after the merge. The first ruling was "no
  worktrees, the branch is the isolation"; that held for two phases and then
  stopped being true.
- **`.mise.toml` is the single source of toolchain truth** for both developers
  and CI. Tasks were written up front, referencing scripts that later phases
  would add — they simply failed until then, which was cheaper than adding and
  removing guards. `mise run check` now runs `goreleaser check` unconditionally
  because `.goreleaser.yaml` exists.
- **CI installs per job, not the whole toolchain**: `install_args` names only
  what that job runs. The test job still installs `oapi-codegen` and `sqlc`
  even though CI never runs `go generate`, because the drift tests shell out to
  them and **never skip** — a pinned tool being absent is a broken environment,
  not a reason to pass.

## Configuration and dispatch

- **Every configuration problem is reported at once**, and a bad one exits
  before the listener opens. One restart per mistake makes first-run setup
  miserable.
- **`MAILGUN_WEBHOOK_SIGNING_KEY` maps to `Config.MailgunSigningKey`** — the
  environment name says which provider's key it is, the field name does not
  need to.
- **The binary is its own dispatch table** (`argv[1]`), and an unrecognised
  subcommand exits 2 rather than falling through to the server: a typo'd
  `mi-casa migrationz` in a scheduled job must fail loudly, not become a web
  server that never completes.
- **`worker` mode serves a bare `/healthz` mux**, not the full API handler. The
  image's HEALTHCHECK probes `/healthz` in every mode, so a worker without it
  would be restart-looped while doing its job perfectly — but mounting the API
  there would let a misrouted proxy send real traffic to a pod that is not in
  the load balancer's rotation.
- **`healthcheck` mode reads `PORT` through `config.FromOS`** like everything
  else. A second default here is a second thing to get wrong, and a container
  whose configuration does not load is not serving anything either.
- **`LOG_LEVEL` is parsed and validated but does not filter yet.** It is in the
  contract because operators expect it; the day something needs suppressing,
  the value is already there.

## Database and migrations

- **Migration `00001` was never edited after it merged.** Wiring the real auth
  library against it turned up one wrong column name, and that became
  `00002_limen_adjustments.sql` — a rename, not a rewrite. Migrations are
  append-only from the moment they land on `main`.
- **`verifications.identifier` became `verifications.subject`** because that is
  what Limen's adapter builds every `WHERE` from. Renaming the column beat
  mapping the field, so one name holds across the schema, the library and any
  future dump.
- **The `rate_limits` table Limen owns is deliberately left wrong.** Limen's
  database-backed limiter reads its count column with a `.(int32)` assertion
  while pgx's `database/sql` driver returns `int64`, so the store would panic
  on the first request. The auth limiter therefore uses Limen's **in-memory**
  store, and the table stays unused: correcting its columns now would only make
  it look usable. The consequence is that auth rate limits are per process —
  fine for a single container, and something a multi-replica deployment should
  cover with a limit at the proxy.
- **`RecordRetentionRun` takes an explicit `ran_at`.** The job runs with an
  injected clock so a test can pin it, and readiness compares against the same
  clock; a query that called `now()` itself would make that comparison
  untestable.
- **The migration advisory-lock key is fixed and must never change.** Two
  binaries mid-rollout using different keys would stop contending with each
  other, and the lock would silently stop doing its job with no error anywhere.

## Auth

- **Limen is confined to `internal/auth`.** Its plugins are pre-1.0, its
  identifiers are typed `any`, and its schema is discovered rather than
  declared. The rest of the app sees an interface and a `Session` struct.
- **`Handler()` is built once, in `New`.** Limen's `Handler()` is a
  *constructor*, not an accessor: calling it twice deletes the custom
  rate-limit rules from a shared config map on the way, silently loosening the
  sign-in, reset and two-factor brakes to the 60/min default.
- **Limen's `list-sessions` and `revoke-sessions` routes are disabled.** The
  list route returns raw session tokens. The app's own `/api/settings` owns
  device listing and revocation instead, and returns row ids.
- **The app's rate-limit key carries the window number**
  (`app:<rule>:<digest>:<window>`), so a fixed window resets by moving to a new
  key rather than by needing a sweeper to reset a counter.
- **Client addresses are only ever stored as keyed digests**, and the app's
  limiter uses the same digest function the auth layer does — so one client
  cannot get two independent budgets by switching routes.
- **Password length is bounded in bytes, not runes**, everywhere, because the
  cap exists to bound the Argon2id input. The handler and the auth package must
  agree to the byte, and they are tested to.
- **`ENVIRONMENT=development` — not `test`** — is what loosens the same-site
  guard. `IsDevelopmentLike()` covers both, and a deployed test environment
  must not have a security check quietly relaxed.

## The API

- **Spec-first, with the spec hand-written.** `openapi/mi-casa.yaml` generates
  the strict server, validates every request at runtime through kin-openapi, and
  generates the SPA's types. `internal/api/mi-casa.yaml` is a committed copy
  that exists only because `go:embed` cannot reach above the module root; a
  drift test compares the two.
- **Field bounds live in the Go handlers, not in the schema.** The ported
  validation messages are rendered next to their inputs in the SPA and had to
  stay verbatim; OpenAPI's own messages are not. The cost is that a
  shape-invalid body answers 400 before a route's own 409 — accepted.
- **`?limit=abc` answers 400** rather than falling back to a default the way
  the TypeScript did: the spec types it as an integer, so the validator gets
  there first. Out-of-range values are clamped. The SPA only ever sends
  numbers.
- **Unknown `/api/*` paths answer a JSON 404** and never fall through to the
  SPA — including under `/api/inbound/`, which is excluded from spec validation
  and would otherwise get the mux's plain-text 404.

## Inbound mail

- **The classifier lives in `internal/classify`**, on its own, because it is
  the one piece that needs both the parsed message and the database:
  `internal/repo` imports `internal/mail` for the parsed type, and
  `internal/domain` must not import `internal/repo` at all.
- **Rejections are expressed as status codes, and 406 is load-bearing.**
  Mailgun retries everything except a 406 for up to eight hours, so a permanent
  rejection has to be a 406 and a transient one has to be anything else.
- **Two rejections have no TypeScript counterpart**, both accepted: a
  `Content-Length` over the budget is refused as `too_large` (406) *before* the
  body is read, because buffering megabytes from a stranger to discover the
  request is unsigned is the wrong order; and a body that will not parse as a
  multipart form is `inbound_rejected` with `reason: malformed` (401), because
  a request we cannot authenticate does not get a message-level answer.
- **A 401 never says which guard refused it.** Signature, clock and replay all
  answer the same thing, so a prober cannot tell a wrong key from a wrong
  clock. The reason goes to the log.
- **The replay guard is in memory and per process.** A database round trip per
  inbound message would buy durability nobody needs; the timestamp window is
  the half of the defence that always holds, and a replay that slipped through
  would produce one duplicate, which `(household, message-id)` uniqueness
  already swallows.
- **A panic in the webhook handler becomes a 500 and an
  `email_ingest_failed`.** It is the one attacker-facing route, it is mounted
  past the generated server's error handling, and a dropped connection with no
  log line is the worst possible answer.
- **Uppercase recipient local parts are lower-cased before slug matching**, as
  the TypeScript did.
- **`mail_send_skipped` no longer exists.** It was a log event for a
  placeholder sender that only logged, used until the real SMTP transport
  landed in the same phase. It is gone, and so is the placeholder.

## Jobs

- **`retention_completed` does not report expired invitations.** The field set
  is verbatim from the TypeScript, and the log consumers were written against
  it. The count is returned from the function; it just is not logged.
- **The run is recorded last, and only on success.** `/readyz` reports
  `retention.stale` from that stamp, so writing it before the work would turn a
  job failing every night into a probe saying everything is fine — the exact
  failure the field exists to catch.
- **The scheduler is pinned to UTC explicitly.** robfig/cron defaults to
  `time.Local` and the image sets no `TZ`, so UTC would otherwise be an
  accident of the base image — while the 30-day retention window is a privacy
  commitment stated in UTC.

## Frontend

- **`openapi-typescript` runs through `bunx --package`.** It pins
  `typescript@^5` as a direct dependency while the workspace is on TypeScript 7;
  installing it as a devDependency breaks the install, and a local-bin
  invocation resolves the wrong TypeScript and crashes. The generated file is
  committed and guarded by a spec-checksum test.
- **Session state is read through a query wrapping the auth client's
  `getSession`**, so route guards and the app chrome have one source rather
  than two that can disagree.
- **`/settings` and `/new-household` sit under a pathless chrome route** rather
  than repeating the layout.
- **`useCurrentUserId` reads the profile, not the session.** Limen's session
  carries the public id, not the row id, and the app's tables key on the row
  id.

## Build and release

- **The Dockerfile compiles nothing.** Binaries are built natively and COPYed,
  which keeps a multi-arch build to seconds of file copying with no QEMU, and
  lets the build reuse the developer's or CI's module and Vite caches.
- **The base is distroless `static`, not `scratch`.** Same absent attack
  surface, but it ships the CA bundle (the SMTP relay is dialled over TLS),
  tzdata, `/tmp` and the `nonroot` user, all maintained upstream.
- **The SPA is overlaid into the `go:embed` directory and restored
  afterwards**, so the working tree stays clean. `restore-embed-overlay.sh`
  uses `git clean -x` scoped to that directory, because the repository
  re-ignores its contents.
- **GoReleaser's `dist` is `dist/goreleaser`.** The repository's own build
  outputs already live in `dist/`, and GoReleaser insists its own is empty.
- **cosign signs into a single Sigstore bundle.** cosign 3.x refuses the old
  `--output-signature`/`--output-certificate` pair, and the dry run exercises
  `sign-blob` and `verify-blob` against a throwaway file — because GoReleaser
  auto-skips signing in snapshot mode, which is how a flag incompatibility
  once reached a real release.
- **The publish environment's URL falls back to the GHCR package page** when
  the `PRODUCTION_URL` repository variable is unset. There is no hosted
  deployment this repository owns, so the package the image lands on is the
  honest answer.
- **Preview images are semver prereleases** of the release they precede
  (`0.2.0-pr.123`), so they always sort below it and can never be mistaken for
  a release. Forks and Dependabot build and smoke-test but publish nothing:
  their token is read-only, and discovering that after the smoke test passes is
  the worst possible place to learn it.
- **A cancelled release deletes its tag too.** A cancelled job is not a failed
  one, so the cleanup keys on the publish step's own outcome rather than on
  `failure()`.
- **`actions/checkout` stays pinned to this repository's existing `v6` hash**
  rather than being bumped alongside new workflows; Dependabot moves it.
- **Preview tags accumulate.** Nothing prunes them yet. Accepted for now.
- **The cron probe is not part of the image smoke test.** The smoke test covers
  `migrate`, the default mode, `/readyz`, the SPA and the webhook's 401; a
  scheduled run adds time without adding much signal.

## The cutover — 2026-09-05

The Cloudflare Workers backend was removed in one commit rather than being
left to rot beside the Go one. What went: `src/`, `test/`, `migrations/` (the
D1 schema — the goose migrations live in `apps/server/internal/db/migrations`),
`wrangler.jsonc`, `drizzle.config.ts`, `requests/`, the root `vite.config.ts`
and `vitest.config.ts`, `.dev.vars.example`, and the four Cloudflare
workflows. `ci-go.yml` took the vacated name `ci.yml`.

- **This is a breaking change.** Not to an API — to the deployment model. A
  Worker on D1 and Cloudflare Email Routing is not a container on Postgres and
  Mailgun, and there is no data migration between them (decided up front, see
  "The migration off Cloudflare"). Anyone still on the Worker stays on the last
  release that contained it.
- **The root `package.json` is now only a workspace root**: Biome, TypeScript,
  Playwright and `otpauth` — everything the SPA needs moved to
  `apps/frontend`, and `npm`/`package-lock.json` went with the Worker. Bun is
  the only JavaScript toolchain. Dependabot keeps reading `bun.lock` through
  the `npm` ecosystem, which is unrelated.
- **One shared module survived the delete**: the household-slug rules the SPA
  imported from `@server/domain/household-slug` now live at
  `apps/frontend/src/lib/household-slug.ts`. `apps/server/internal/domain/slug.go`
  is the authority; the copy is pre-submit validation, and the reserved set now
  matches the Go one exactly (it gained `healthz` and `readyz`).
- **The `Ports src/server/…` comments in the Go packages stay.** They name a
  path that no longer exists, deliberately: they are provenance for a port, and
  the original is one `git log` away. Rewriting seventy comments to say
  "formerly" would have bought nothing.
- **CodeQL now scans both trees**, `go` in `build-mode: manual` (the module is
  not at the repository root, so autobuild is not dependable) and
  `javascript-typescript` in `build-mode: none`.
- **The changelog now has a `Breaking changes` group, and `^chore` no longer
  excludes `chore!:`.** Writing this commit exposed both: `.goreleaser.yaml`
  dropped every `^chore` commit from the release notes, so the one commit that
  most needed to be in them — the breaking change that bumps the minor under
  `--v0` — would have vanished. The exclude is now anchored on the colon
  (`^chore(\(.+\))?:`), so routine chores still go and breaking ones stay, and
  a `Breaking changes` group matching the `!:` marker on any type is declared
  first, because GoReleaser assigns a commit to the earliest group that
  matches and `feat!:` matches Features too. The release header now says there
  is no data migration from the Workers deployment, where a reader arriving
  from an old install will actually see it.

## Accepted limitations

Known, deliberate, and worth knowing before filing a bug:

- Auth rate limits are **per process** (see the `rate_limits` note above). With
  several replicas, put a limit in front of `/api/auth/`.
- The replay guard is **per process** and forgotten on restart.
- Nothing prunes old preview image tags in GHCR.
- Passkeys are gone until Limen or a custom plugin covers WebAuthn.
- There is no backup job in the app. Postgres is the whole state; take a
  `pg_dump` on your own schedule.
