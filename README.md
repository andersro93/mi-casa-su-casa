<div align="center">
  <img src="assets/mi-casa-su-casa-logo.png" alt="Mi Casa Su Casa" width="120" />

  # Mi Casa Su Casa

  **A shared verification inbox for families — self-hosted, one container.**

  *"mi casa su casa" — my house is your house*

  [![CI (Go)](https://github.com/andersro93/mi-casa-su-casa/actions/workflows/ci-go.yml/badge.svg)](https://github.com/andersro93/mi-casa-su-casa/actions/workflows/ci-go.yml)
  [![Release](https://github.com/andersro93/mi-casa-su-casa/actions/workflows/release.yml/badge.svg)](https://github.com/andersro93/mi-casa-su-casa/actions/workflows/release.yml)
  [![Latest release](https://img.shields.io/github/v/release/andersro93/mi-casa-su-casa?sort=semver&label=release)](https://github.com/andersro93/mi-casa-su-casa/releases)
  [![Container image](https://img.shields.io/badge/ghcr.io-mi--casa--su--casa-2496ed)](https://github.com/andersro93/mi-casa-su-casa/pkgs/container/mi-casa-su-casa)
  [![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
</div>

---

## What it solves

Households share streaming and similar consumer accounts. When one of those
services emails a one-time code, the friction is never the login — it is
finding the right message, in the right mailbox, on someone else's phone, in
the ninety seconds before the code expires.

Mi Casa Su Casa gives the household **one inbound address**, and turns what
arrives at it into a screen anybody in the family can read:

- **Latest codes first.** One card per service with its newest code and a
  Copy button. No threads, no folders, no scrolling.
- **One address, many services.** Mail to `<household-slug>@your-domain` is
  matched against sender rules the owner configures, grouped by service, and
  the one-time code is pulled out of the body for you.
- **Nothing unknown gets in quietly.** A sender nobody recognised — or one
  whose SPF/DKIM verdict does not back up the address it claims — lands in
  **Needs review** for the owner, not in the family's inbox.
- **Invite-only, owner-controlled.** No public sign-up. Members are invited
  by email or link, and the owner decides which services each member can see.
- **Plain text only.** Message bodies are rendered as text, never as HTML. A
  verification email is not a document worth executing.
- **It forgets.** Mail is purged 30 days after it arrives, every night, by a
  job that reports whether it ran.

Everything lives in Postgres. There is no object store, no volume for the
app, and nothing on disk to back up.

## What it looks like

<p>
  <img src="docs/screenshots/inbox-mobile-light.png" alt="Latest codes on a phone: one card per service with its newest code and a Copy button" width="260" />
  <img src="docs/screenshots/inbox-mobile-dark.png" alt="The same screen in dark mode" width="260" />
</p>

![Latest codes on desktop: services on the left, the selected service's newest code and messages on the right](docs/screenshots/inbox-desktop-light.png)

![Services page: one card per service with its senders, add sender, rename and delete on the card](docs/screenshots/services-desktop-light.png)

In the app the concepts are named for families, not operators: **Services**
(providers and their sender rules), **Members**, **Needs review**
(quarantine), **Latest codes** (the inbox). The API keeps the original names.

## Quick start

Nothing to clone, nothing to build, two containers:

```sh
curl -O https://raw.githubusercontent.com/andersro93/mi-casa-su-casa/main/docker-compose.selfhost.yml

cat > .env <<EOF
APP_URL=https://casa.example.com
EMAIL_DOMAIN=casa.example.com
OWNER_EMAIL=you@example.com
AUTH_SECRET=$(openssl rand -hex 32)
SETUP_SECRET=$(openssl rand -hex 16)
MAILGUN_WEBHOOK_SIGNING_KEY=...
SMTP_URL=smtps://user:pass@smtp.example.com:465
OUTBOUND_EMAIL_FROM=no-reply@casa.example.com
EOF

docker compose -f docker-compose.selfhost.yml up -d
```

That brings up Postgres and the app on port 3000. The default dispatch mode
applies pending migrations under a Postgres advisory lock before it starts
serving, and runs the nightly retention job in-process — so there is no
separate migration step and no cron to wire up.

Keep the settings in a `.env` file next to the compose file rather than on the
command line: every variable in that file reads from the environment, and
`docker compose` loads `.env` automatically. **If `AUTH_SECRET` changes, every
existing session is invalidated.**

Then open `https://casa.example.com/setup` and claim the installation. The
form asks for the `OWNER_EMAIL` and `SETUP_SECRET` you just set, your name and
a password, and the name and slug of the first household. The slug becomes the
local part of that household's inbound address (`casa` →
`casa@casa.example.com`). `/setup` locks permanently once it succeeds: it
answers 409 *before* the secret is compared, so from that moment the value
stops mattering.

**Keep the variable set anyway.** The config loader requires all nine on every
boot and refuses to start without them, so `SETUP_SECRET` cannot be removed —
only rotated, which it is now free to be.

Mail will not arrive yet: point `EMAIL_DOMAIN`'s MX records at Mailgun and add
the route first — see [Receiving mail with Mailgun](#receiving-mail-with-mailgun)
below, and [`docs/inbound-mail.md`](docs/inbound-mail.md) for the whole story.

Already running Postgres? Skip the compose file:

```sh
docker run -d --name mi-casa -p 3000:3000 \
  -e DATABASE_URL='postgres://micasa:pw@host:5432/micasa' \
  -e APP_URL='https://casa.example.com' \
  -e AUTH_SECRET='...' \
  -e SETUP_SECRET='...' \
  -e OWNER_EMAIL='you@example.com' \
  -e EMAIL_DOMAIN='casa.example.com' \
  -e MAILGUN_WEBHOOK_SIGNING_KEY='...' \
  -e SMTP_URL='smtps://user:pass@smtp.example.com:465' \
  -e OUTBOUND_EMAIL_FROM='no-reply@casa.example.com' \
  ghcr.io/andersro93/mi-casa-su-casa:latest
```

## Self-hosting

The image is `ghcr.io/andersro93/mi-casa-su-casa`, built for `linux/amd64`
and `linux/arm64`. The tags are a pinning ladder — pick how much you want to
move on upgrade day:

| Tag | Moves | Risk appetite |
| --- | --- | --- |
| `:0.1.0` | never | pin exactly, upgrade deliberately |
| `:0.1` | with patch releases | fixes only |
| `:0` | with minor releases | pre-1.0 minors may break — read the release notes |
| `:latest` | every release | living on the edge |
| `:sha-<commit>` / `@sha256:…` | never | byte-exact, provenance via cosign |

Set the tag with `MI_CASA_TAG` when you use the compose file
(`MI_CASA_TAG=0.1 docker compose -f docker-compose.selfhost.yml up -d`).

Inside the image is a single static Go binary on a distroless `static` base
pinned by digest: no shell, no libc, no package manager, nothing to `exec`
into — just the CA bundle, tzdata and the `nonroot` user (uid 65532)
maintained upstream. The SPA, the OpenAPI spec, the SQL migrations and the
IANA timezone database are all compiled into the binary. There is no volume,
because the app writes nothing to disk.

Two things worth knowing before you commit to the image: every release also
ships the bare binaries, so Docker is optional
([Running without Docker](#running-without-docker)), and everything published
is cosign-signed, so you can check what you pulled
([Verifying a release](#verifying-a-release)).

### Configuration

Environment variables only, validated at startup — and *every* problem is
reported at once, so a misconfigured container crash-loops with a list rather
than making you fix one variable per restart. **Nine are required:**

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://micasa:pw@db:5432/micasa` |
| `APP_URL` | The public origin people type. Sessions are signed and the links in outbound mail are built from it, and the loader **refuses a non-`https://` value** unless `ENVIRONMENT` is `development` or `test`. A wrong value breaks sign-in in ways that look like anything except a configuration error |
| `AUTH_SECRET` | At least 32 characters — `openssl rand -hex 32`. Hashed into the 32-byte key the auth layer wants. Changing it signs everyone out |
| `SETUP_SECRET` | The one-time secret `/setup` asks for on first run, so a freshly exposed instance cannot be claimed by whoever finds it first. Any strong passphrase. Still required at every boot once setup is locked — the value stops mattering, the variable does not |
| `OWNER_EMAIL` | The address of the first account, created by that same `/setup` run. Lower-cased, and the form's address must match it |
| `EMAIL_DOMAIN` | The domain household inboxes live on — each household receives mail at `<slug>@EMAIL_DOMAIN`. A bare lower-case hostname like `casa.example.com`: no scheme, no `@` |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Mailgun's **HTTP webhook signing key** (not the API key). Every inbound POST is verified against it |
| `SMTP_URL` | The relay outbound mail is sent through — `smtp://user:pass@host:587` or `smtps://user:pass@host:465`. See [Sending mail](#sending-mail) |
| `OUTBOUND_EMAIL_FROM` | The `From` address on invitation and password-reset mail. Must be an address your relay is allowed to send as |

Everything else has a default:

| Variable | Default | Effect |
| --- | --- | --- |
| `APP_NAME` | `Mi Casa Su Casa` | Display name in the UI, in outbound mail, and as the TOTP issuer |
| `ENVIRONMENT` | `production` | `development` and `test` relax the `https://` requirement on `APP_URL`; `development` additionally loosens the same-site guard so a local Vite dev server works. Never set either on a deployment |
| `PORT` | `3000` | The port the process listens on. The image's `HEALTHCHECK` probes this port too |
| `TRUSTED_PROXY_HOPS` | `0` | Number of reverse proxies in front. At `0` the app trusts the socket's peer address and **ignores** `X-Forwarded-For`, because it is caller-supplied |
| `LOG_LEVEL` | `info` | Accepted and validated, but not yet used to filter output: every event line is written regardless |

Misconfiguration exits before the listener opens. `/healthz` depends on
nothing beyond `PORT`.

### Receiving mail with Mailgun

Inbound household mail arrives as a signed webhook POST from a Mailgun route —
there is no SMTP listener in the image. Three things to set up:

1. **A receiving domain.** Add `EMAIL_DOMAIN` in Mailgun and publish the DNS
   records it asks for: the **MX** records (`mxa.mailgun.org` and
   `mxb.mailgun.org`, priority 10) so mail reaches Mailgun at all, plus the
   **TXT** verification and DKIM records. Use a dedicated subdomain
   (`casa.example.com`) if the apex already handles mail — MX records are per
   hostname, and there is no way to split them between two providers.

2. **A route.** Mailgun → *Receiving → Routes → Create route*, with an
   expression that matches every mailbox on the domain and a single action:

   ```
   match_recipient(".*@casa.example.com")
   forward("https://casa.example.com/api/inbound/mailgun/mime")
   ```

   The URL **must end in `mime`**: that is what makes Mailgun post the raw
   RFC 5322 message in a `body-mime` field instead of a pre-parsed
   `body-plain`/`body-html` pair. The app reads only `body-mime`.

3. **The signing key.** Mailgun's *HTTP webhook signing key* (not the API
   key), as `MAILGUN_WEBHOOK_SIGNING_KEY`. Every POST carries `timestamp`,
   `token` and `signature`; the app recomputes
   `hex(HMAC-SHA256(key, timestamp + token))` and compares it in constant
   time, refuses timestamps more than 5 minutes off in either direction, and
   refuses a `token` it has already seen in the last 10 minutes.

What the endpoint answers, and why it matters:

- **200** — the message was stored, or quarantined for review. It is ours now.
- **401** — the request was not authenticated: wrong key, skewed clock,
  replay, or a body that would not parse as a form. Mailgun retries it, and it
  will keep failing until the key or the clock is fixed.
- **406** — a *permanent* rejection Mailgun does not retry: the message was
  too large (`body-mime` is capped at 2 MiB), unparseable, addressed to a
  household that does not exist here, or aimed at a quarantine that is already
  full.
- **500** — something broke on our side, and Mailgun should retry. It does,
  for up to eight hours.

The full guide — including how to send a correctly signed test request with
`openssl` and `curl` — is [`docs/inbound-mail.md`](docs/inbound-mail.md).

### Sending mail

Outbound mail is only invitations and password resets, sent one message per
connection over `SMTP_URL`:

| Form | Behaviour |
| --- | --- |
| `smtp://host:587` | STARTTLS, **required** — a relay that offers no upgrade is refused rather than spoken to in the clear |
| `smtps://host:465` | TLS from the first byte |
| `smtp://user:pass@host:587` | PLAIN authentication with the userinfo |
| `smtp://host:1025?starttls=off` | Never upgrade. What a plain relay on a private network needs — see the note below |

The STARTTLS requirement is waived only for a **loopback host** — `localhost`
or a loopback IP such as `127.0.0.1` or `::1`, and nothing else.

> **The trap:** a plain relay reached by a *container or service name* is not
> loopback. `smtp://mailpit:1025` on a compose network, or
> `smtp://smtp.internal:25` on a cluster, hits the STARTTLS requirement and
> every send fails against a relay that offers no upgrade. Either put the
> relay on loopback, or say so in the URL:
> `smtp://mailpit:1025?starttls=off`. It is spelled out there deliberately, so
> it shows up in a review of the deployment rather than hiding behind an
> "insecure" flag nobody reads.

URL-encode the password if it contains `@ : / #`.

Mailgun's own relay works fine here, so receiving and sending can be the same
account: `smtps://postmaster%40casa.example.com:<smtp-password>@smtp.eu.mailgun.org:465`.
`OUTBOUND_EMAIL_FROM` must be an address the relay will send as, or the mail
is rejected or spam-filed.

### Behind a proxy

`APP_URL` must be the address people actually type, including `https://`. The
app speaks plain HTTP and has no business on a public interface directly: bind
it to loopback (`127.0.0.1:3000:3000` in the compose file) and let
nginx/Caddy/Traefik terminate TLS in front of it.

Set `TRUSTED_PROXY_HOPS` to the number of proxies in front — one reverse proxy
is `1`, Cloudflare in front of that one is `2`. Count too low and the rate
limiter buckets every client together; count too high and a caller can spoof
their address.

`GET /healthz` is liveness: it touches nothing, not even the database pool, so
a Postgres outage can never turn "the process is up" into a restart loop.
`GET /readyz` is what a readiness probe wants — it reads the installation row,
which both proves Postgres is reachable and carries the retention job's last
success:

```json
{"ok":true,"status":"ready","setupConfigured":true,
 "retention":{"lastRunAt":"2026-09-04T03:00:11.412Z","stale":false}}
```

`retention.stale` is true until the job has run once, and whenever the last
success is more than 48 hours old. A failed database read answers **503** with
`{"ok":false,"error":"database unavailable"}`.

### Scheduled work

One job: **retention**, at `0 3 * * *` **UTC** — purge mail past its 30-day
window in bounded batches, expire pending invitations, record the run, and
sweep both rate limiters' expired counters. Which dispatch mode you run
decides who does it:

| Mode | HTTP | Migrates | Scheduler |
| --- | --- | --- | --- |
| *(default, no argument)* | the whole app | yes, under an advisory lock | yes |
| `server` | the whole app | no | no |
| `worker` | `/healthz` only | no | yes |

`migrate` (alias `migrations`), `cron <job>` and `healthcheck` are one-shot
commands rather than long-running modes: they do one thing and exit 0 or 1.
An unknown subcommand, or an unknown job name, exits 2 — loudly, rather than
falling through to a web server nobody asked for.

**One container:** run the image with no argument. It migrates itself, serves
the app, and schedules, all in one process. That is what both compose files
do.

**Several replicas:** scale `server` horizontally — it never migrates and
never schedules, so any number of them is safe — and drive the scheduled work
one of two ways:

- one dedicated `worker` replica, same image, argument `worker`, running the
  scheduler and a bare `/healthz` so the image's own HEALTHCHECK still passes;
  or
- a CronJob against the same image:

  ```sh
  /app/mi-casa cron retention     # 0 3 * * * (UTC)
  ```

  Set `concurrencyPolicy: Forbid` — nothing else stops two runs overlapping.

Either way, run at most **one** thing that schedules. The scheduler fires once
per process, so two `worker` replicas — or a `worker` alongside a CronJob —
run every night's purge twice. The purge is idempotent, so that is wasteful
rather than wrong, but it is still worth designing against.

The contributor stack has one-off services for both, behind the `tools`
profile so `docker compose up` does not start them:

```sh
docker compose run --rm migrate
docker compose run --rm cron retention
```

### Upgrading

A single instance upgrades by pulling the new image and restarting it. The
default mode takes a Postgres advisory lock before applying anything pending,
so there is no separate step and no race with itself:

```sh
docker compose -f docker-compose.selfhost.yml pull
docker compose -f docker-compose.selfhost.yml up -d
```

For a rollout with more than one instance, run migrations as an explicit
one-off **before** the new image serves traffic. Migrations are append-only,
so old code running briefly against a newer schema is safe, while new code
against an older schema is not:

```sh
docker run --rm \
  -e DATABASE_URL=... [and the other required variables] \
  ghcr.io/andersro93/mi-casa-su-casa:<new-version> migrate
```

Under Kubernetes that is a Job or an initContainer. It is safe to run
alongside instances still on the old image, and safe to run twice — the
advisory lock means a `migrate` one-off and a booting default-mode container
can never race each other either.

### Backups

**Back up Postgres.** It is the entire application state: households,
memberships, services and sender rules, messages, quarantine, invitations,
sessions and the audit log. The app stores nothing on disk, so there is no
second thing to copy — and no second copy of the database anywhere.

```sh
docker compose -f docker-compose.selfhost.yml exec -T db \
  pg_dump -U micasa micasa | gzip > micasa-$(date +%F).sql.gz
```

A backup written to the same host as the database is not a backup. Copy it
somewhere else, and test a restore before you need one —
[`docs/runbook.md`](docs/runbook.md) has the procedure.

### Where your data lives

The `messages` and `quarantine_messages` tables hold the **text bodies of real
emails**, including the one-time codes extracted from them. That is the
product, and it is also the most sensitive thing here: a code sitting in the
database is a code somebody can still use for as long as the sending service
honours it.

Two consequences worth stating plainly:

- **Retention is 30 days**, enforced nightly by the retention job. If that job
  stops running, nothing is purged — which is exactly why `/readyz` reports
  `retention.stale`, and why the alert set in
  [`docs/operations.md`](docs/operations.md) watches it.
- **Your backups inherit all of it.** A `pg_dump` of this database is a dump
  of the household's mail. Encrypt it, and put it somewhere you would be
  comfortable putting the mailbox itself.

Logs never carry message bodies or codes. An event line says what happened, to
which household, and whether a code was found — never what it was.

## How it's built

One process, one image, one origin: the Go binary serves the SPA, the API
under `/api`, the auth routes and the inbound webhook, all on the same port.

```
browser ──HTTPS──▶ reverse proxy ──▶ mi-casa (Go, :3000) ──▶ Postgres
                                        │
Mailgun route ──POST /api/inbound/mailgun/mime──┘
mi-casa ──SMTP──▶ relay (Mailgun SMTP or any other)
```

| Layer | Choice |
| --- | --- |
| Runtime | Go 1.27, stdlib `net/http`, no framework. One static CGO-free binary on distroless `static`, with the SPA, the spec, the migrations and the tz database embedded in it |
| API | Spec-first: `openapi/mi-casa.yaml` is hand-written and authoritative. oapi-codegen generates the strict server, kin-openapi validates every request against the same spec at runtime, and openapi-typescript generates the SPA's client types from it |
| Data | pgx + sqlc (typed Go from plain SQL) + goose migrations, on Postgres. Everything the app keeps lives there — inbound mail and all |
| Auth | [Limen](https://github.com/thecodearcher/limen) — email and password, password reset, TOTP two-factor with backup codes. No public sign-up: accounts come from `/setup` and from invitation acceptance only. Confined to `internal/auth` behind one interface, with its HTTP routes on an allowlist |
| Frontend | Vite + React 19, MUI v9, TanStack Router and Query, `openapi-fetch` against the generated schema. Installable PWA with an app-shell service worker that never caches API data |
| Tests | `go test -p 1 ./...` against a real Postgres — tenancy, setup, invitations, the classifier and the retention job run against the database they ship on. Playwright drives the real container image |

Every household-scoped table carries a household id, and the scope is written
into the SQL of every query rather than left to a handler to remember:
cross-household access is structurally impossible, and tested to stay that
way.

`internal/api` receives its collaborators. `cmd/mi-casa` builds a `Deps`
struct once at startup and hands it to `NewHandler(deps)`; nothing below that
line reads the environment or constructs a client, which is what lets the
suite exercise the whole API in-process without a container.

## Development

Two toolchains, because the app is two halves: Go builds the server, Bun
builds the SPA. You do not install either by hand —
[mise](https://mise.jdx.dev) pins both (plus the codegen and release tools) in
`.mise.toml`, and CI installs from the same file.

```sh
mise install
bun install
docker compose -f docker-compose.test.yml up -d   # Postgres on 127.0.0.1:55433
```

The server needs the same variables the container does. For a laptop, point
`DATABASE_URL` at that compose database and set `ENVIRONMENT=development` so
an `http://` `APP_URL` is legal:

```sh
export DATABASE_URL=postgres://micasa:micasa@127.0.0.1:55433/micasa_test
export ENVIRONMENT=development
export APP_URL=http://localhost:3000
export AUTH_SECRET=dev-secret-do-not-use-in-production-0123456789
export SETUP_SECRET=dev-setup-secret
export OWNER_EMAIL=owner@example.com
export EMAIL_DOMAIN=example.com
export MAILGUN_WEBHOOK_SIGNING_KEY=dev-signing-key
export SMTP_URL=smtp://localhost:1025
export OUTBOUND_EMAIL_FROM=no-reply@example.com

cd apps/server && go run ./cmd/mi-casa migrate   # apply the schema
cd apps/server && go run ./cmd/mi-casa           # API on :3000 (also migrates, then serves)
bun run --filter @mi-casa/frontend dev           # SPA on :5173, proxying /api, /healthz and /readyz to :3000
```

There is no seed script: run `/setup` with the `OWNER_EMAIL` and
`SETUP_SECRET` above. That is the same bootstrap a self-hoster does, so it is
the path that stays tested.

```sh
mise run test        # go vet + go test -p 1 -count=1 ./... against the compose Postgres, then the TS suite
mise run check       # Biome + tsc, then goreleaser check
mise run e2e         # Playwright against the real container image
mise run artifacts   # SPA + both server binaries → dist/server/linux/<arch>/mi-casa
mise run image       # multi-arch image via buildx (runs artifacts first)
mise run snapshot    # full GoReleaser dry run: archives, SBOMs, local image; no publish, no signing
```

`-p 1` is not optional: several Go packages truncate shared tables between
tests and cannot run as concurrent packages against one database.

After editing `openapi/mi-casa.yaml`, run `go generate ./...` from
`apps/server` (needs `oapi-codegen` **and** `sqlc` on `PATH` — `mise install`
puts both there) and `bun run gen:client` from the root. Generated code is committed; neither
CI nor the image runs a code generator, and a drift test fails when the
committed output is stale.

`docker-compose.yml` is the contributor's stack: it builds from source, so run
`bash scripts/build-artifacts.sh` first — the Dockerfile is COPY-only and
expects `dist/server/linux/<arch>/mi-casa` to exist.
`docker-compose.selfhost.yml` pulls the published image and is the
self-hoster's. They are deliberately separate so a self-hoster never needs the
repository.

### Versioning and images

Versions are computed from [Conventional Commits](https://www.conventionalcommits.org)
since the last `v*` tag by [svu](https://github.com/caarlos0/svu) — nobody
types a version number:

```sh
mise x -- svu next --v0             # what the next release would be
```

`feat` bumps the minor, `fix`/`perf` the patch, `!`/`BREAKING CHANGE` the
major. `--v0` keeps a breaking change bumping the minor while the major is 0,
so reaching 1.0 stays a decision (the Release workflow's `allow_major` input)
rather than a side effect of a commit message.

CI publishes a **preview** image for every pull request — after the smoke test
passes, never before. Preview tags are semver prereleases of the release they
precede, so they always sort below it:

```
ghcr.io/andersro93/mi-casa-su-casa:<next-version>-pr.<number>          # moves with the PR
ghcr.io/andersro93/mi-casa-su-casa:<next-version>-pr.<number>.<sha>    # immutable
```

Pull requests from forks and from Dependabot build and smoke-test the image
but publish nothing: their `GITHUB_TOKEN` is read-only.

**Merging to main is releasing.** Every merge with releasable commits
(`feat`/`fix`/`perf`/breaking since the last tag) computes the version with
svu, re-runs the full suite on the merge commit, creates the tag, and hands
everything downstream to [GoReleaser](https://goreleaser.com): binary archives
with checksums and SPDX SBOMs on a GitHub Release with a generated changelog,
the multi-arch image, and keyless
[cosign](https://github.com/sigstore/cosign) signatures over both. A failed or
cancelled publish deletes the tag again, so a tag never points at a release
that does not exist. Docs/chore-only merges end green without releasing. The
manual dispatch remains for two levers only: `dry_run` (the full pipeline as a
snapshot, nothing pushed) and `allow_major`.

**Image tags carry no `v`.** The git tag is `v0.1.0`; the image is
`ghcr.io/andersro93/mi-casa-su-casa:0.1.0` — GoReleaser's version template
strips the prefix. `docker pull …:v0.1.0` fails with `not found`, which is an
easy minute to lose.

Building one locally:

```sh
bash scripts/build-artifacts.sh                 # SPA + both server binaries, natively
docker build -t mi-casa:dev .                   # single arch, seconds — COPY-only
bash scripts/build-image.sh                     # runs both steps, assembles both arches
TAG=ghcr.io/andersro93/mi-casa-su-casa:v1 PUSH=1 bash scripts/build-image.sh
```

Nothing compiles inside Docker: the SPA and both server binaries are built
natively (the SPA is embedded into the binaries via `go:embed`), and the
Dockerfile only COPYs the binary matching each platform's `TARGETPLATFORM`.
Neither architecture ever runs under QEMU, and the multi-arch assemble costs
seconds. A multi-platform result is a manifest list, which the local image
store cannot hold, which is why the two-arch build without `PUSH=1` verifies
and discards.

### Running without Docker

Every release ships the bare binaries too — the SPA, the spec, the migrations
and tzdata are embedded, so one file plus Postgres is a complete deployment:

```sh
curl -LO https://github.com/andersro93/mi-casa-su-casa/releases/latest/download/mi-casa_<version>_linux_amd64.tar.gz
tar xzf mi-casa_<version>_linux_amd64.tar.gz
DATABASE_URL=... APP_URL=... AUTH_SECRET=... SETUP_SECRET=... OWNER_EMAIL=... \
EMAIL_DOMAIN=... MAILGUN_WEBHOOK_SIGNING_KEY=... SMTP_URL=... OUTBOUND_EMAIL_FROM=... \
  ./mi-casa    # migrates itself, serves, schedules — same dispatch modes as the image
```

### Verifying a release

Releases are signed with keyless cosign via GitHub's OIDC — the signature
proves the artifacts came out of this repository's release workflow.

```sh
# 1. The checksum file's Sigstore bundle (covers every archive transitively):
cosign verify-blob \
  --bundle checksums.txt.sigstore.json \
  --certificate-identity-regexp 'https://github.com/andersro93/mi-casa-su-casa/\.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  checksums.txt

# 2. Your download against the verified checksums:
sha256sum --check --ignore-missing checksums.txt

# 3. Or the container image directly:
cosign verify ghcr.io/andersro93/mi-casa-su-casa:<version> \
  --certificate-identity-regexp 'https://github.com/andersro93/mi-casa-su-casa/\.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Repository layout

```
openapi/mi-casa.yaml                the API contract — hand-written, and the source of both
                                    the generated Go server and the SPA's client types
apps/server/                        the Go module (github.com/andersro93/mi-casa-su-casa/server)
  ├─ cmd/mi-casa/                   composition root + dispatch table: default, server, worker,
  │                                 migrate, cron <job>, healthcheck
  └─ internal/
      ├─ api/                       routes, middleware, gen/ (oapi-codegen output)
      ├─ auth/                      the ONLY package that imports Limen, behind auth.Service
      ├─ classify/                  which household and service an inbound message belongs to
      ├─ config/                    every environment variable, validated at startup
      ├─ cron/                      the UTC scheduler and the job table
      ├─ db/                        queries/ (SQL) → gen/ (sqlc), migrations/ (goose)
      ├─ domain/                    slugs, code extraction, authentication verdicts
      ├─ invite/                    the invitation service the admin routes share
      ├─ jobs/                      retention
      ├─ log/                       the structured event log
      ├─ mail/                      Mailgun webhook verification, MIME parsing, SMTP sending
      ├─ ratelimit/                 the app's own Postgres-backed limiter
      ├─ repo/                      household-scoped SQL
      ├─ security/                  constant-time comparison, keyed address digests, token minting
      ├─ web/                       static asset serving, security headers, the embedded SPA
      └─ testrig/                   the in-process HTTP rig the route tests drive
apps/frontend/     @mi-casa/frontend  React SPA (screens, PWA plumbing) + tests
scripts/                            build-artifacts.sh, build-image.sh, the embed overlay pair
docs/                               inbound mail, operations, runbook, CI/CD
Dockerfile                          COPY-only, distroless static, non-root
docker-compose.yml                  build from source (contributors)
docker-compose.selfhost.yml         pull the published image (self-hosters)
docker-compose.test.yml             Postgres for the Go suite
```

`apps/server` is a Go module and deliberately *not* a bun workspace: the two
toolchains never call each other, and the Dockerfile is the only place they
meet.

## Cloudflare Workers deployment (legacy)

Mi Casa Su Casa began as a Cloudflare Worker, and that deployment is still in
this repository — `src/`, `wrangler.jsonc`, `migrations/` (the D1 schema),
`test/`, and the `ci.yml`, `preview-deploy.yml`, `production-deploy.yml` and
`production-d1-migrate.yml` workflows. It keeps working until the cutover
release removes it, so nothing is lost mid-migration.

**It is not the supported way to run this project.** The Worker uses
Cloudflare Email Routing and D1 rather than Mailgun and Postgres, there is no
data migration between the two, and the container starts with an empty
database. If you are still running it, the pipeline is described under "Legacy
Cloudflare workflows" in
[`docs/ci-cd-architecture.md`](docs/ci-cd-architecture.md).

Everything else in this README describes the container.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — features start as issues, pull
requests carry tests, and `main` stays deployable. The boring choices made
along the way are logged in [DECISIONS.md](DECISIONS.md).

## License

[MIT](LICENSE).

Security reports: see [SECURITY.md](SECURITY.md).
