# Operator runbook

Procedures for the things that go wrong at 2 a.m. Everything below assumes the
container deployment: the image `ghcr.io/andersro93/mi-casa-su-casa` and a
Postgres you can reach.

The examples use the self-host compose stack
(`docker compose -f docker-compose.selfhost.yml`, service names `app` and
`db`). Adapt the container names for Kubernetes or a bare `docker run`; the
commands inside are the same.

See also: [`operations.md`](./operations.md) (log events, health, alerts),
[`inbound-mail.md`](./inbound-mail.md) (the Mailgun side) and
[`ci-cd-architecture.md`](./ci-cd-architecture.md) (how a release is built).

**Before you touch the database, take a dump** — §2. It costs a minute.

---

## 1. Roll back a bad release

There is one artifact and one lever: the image tag. Rolling back does not
touch the database.

```sh
# Which version is running?
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' \
  $(docker compose -f docker-compose.selfhost.yml ps -q app)

# Go back to the previous one.
MI_CASA_TAG=0.3.1 docker compose -f docker-compose.selfhost.yml up -d app
```

Put the tag in your `.env` rather than the command line so a later
`docker compose up` does not silently move you forward again. Under Kubernetes
this is `kubectl set image` or a revert of the manifest.

**Migrations do not roll back.** They are append-only, and the old image keeps
working against the newer schema — that is the invariant the whole rollout
model rests on. If a *migration* is the problem rather than the code, you are
in §3, not here.

Every release also carries a `sha-<commit>` tag and an image digest, so
`ghcr.io/andersro93/mi-casa-su-casa@sha256:…` pins a byte-exact rollback
target when a moving tag is under suspicion (see §7).

---

## 2. Back up and restore the database

Postgres is the entire application state — households, memberships, services
and sender rules, messages and quarantine, invitations, sessions, the audit
log. The app writes nothing to disk, so there is nothing else to copy, and no
second copy anywhere.

### Take a dump

```sh
docker compose -f docker-compose.selfhost.yml exec -T db \
  pg_dump -U micasa micasa | gzip > micasa-$(date +%F).sql.gz
```

Or the custom format, which restores selectively and in parallel:

```sh
docker compose -f docker-compose.selfhost.yml exec -T db \
  pg_dump -U micasa -Fc micasa > micasa-$(date +%F).dump
```

A dump written to the same host as the database is not a backup. Copy it
elsewhere. **And encrypt it**: it contains the household's mail, including the
one-time codes extracted from it.

Run it on a schedule — a nightly cron on the host with a retention of your
own choosing is enough; there is no backup job inside the app.

### Restore

Restore into an **empty** database, with the app stopped, and then start the
app so it re-applies migrations (a no-op if the dump was current):

```sh
docker compose -f docker-compose.selfhost.yml stop app

# Start from an empty database either way:
docker compose -f docker-compose.selfhost.yml exec -T db psql -U micasa -d postgres \
  -c 'DROP DATABASE IF EXISTS micasa;' -c 'CREATE DATABASE micasa OWNER micasa;'

# Plain SQL dump:
gunzip -c micasa-2026-09-04.sql.gz \
  | docker compose -f docker-compose.selfhost.yml exec -T db psql -U micasa -d micasa

# Custom format:
docker compose -f docker-compose.selfhost.yml exec -T db \
  pg_restore -U micasa -d micasa --clean --if-exists < micasa-2026-09-04.dump

docker compose -f docker-compose.selfhost.yml start app
```

Then check `/readyz`. Two things to expect after any restore:

- **Everyone stays signed in or gets signed out depending on the dump's age** —
  sessions are rows in the database, so the restore rolls them back with
  everything else.
- **`retention.stale` may read `true`** until the next nightly run, because
  `app_installation.last_retention_run_at` came back with whatever the dump
  held. That is correct, not a fault.

A restore from a dump older than the running image's schema is fine: the app
migrates forward at boot. A restore from a **newer** dump into an **older**
image is not — roll the image forward first.

---

## 3. Migrations

Migrations are embedded in the binary and applied by goose under a Postgres
advisory lock, so several containers booting at once serialise instead of
racing. The applied set lives in the `goose_db_version` table.

```sh
# What has been applied?
docker compose -f docker-compose.selfhost.yml exec -T db \
  psql -U micasa micasa -c 'SELECT version_id, is_applied, tstamp FROM goose_db_version ORDER BY id;'
```

**Apply them as a one-off**, which is what a multi-replica rollout wants
before the new image serves traffic:

```sh
docker run --rm \
  -e DATABASE_URL=postgres://micasa:pw@db:5432/micasa \
  -e APP_URL=... -e AUTH_SECRET=... -e SETUP_SECRET=... -e OWNER_EMAIL=... \
  -e EMAIL_DOMAIN=... -e MAILGUN_WEBHOOK_SIGNING_KEY=... \
  -e SMTP_URL=... -e OUTBOUND_EMAIL_FROM=... \
  ghcr.io/andersro93/mi-casa-su-casa:<version> migrate
```

`migrate` requires the full configuration even though it only touches the
database — the config loader validates everything at once, by design. With the
contributor stack, `docker compose run --rm migrate` does the same thing with
the environment already filled in.

It exits `0` on success and `1` with the failure in the log. It is safe to run
twice, and safe to run alongside a booting default-mode container.

**A migration that failed halfway** leaves the schema partly changed and
`goose_db_version` without that version's row. Do not edit the migration and
retry — restore from the dump you took in §2, roll the image back to the
previous tag (§1), and fix forward with a new migration. Migrations are
append-only; an applied one is never edited.

---

## 4. Recover a lost owner account

Work through these in order — each is less invasive than the next.

### The owner forgot their password

Use *Forgot your password?* on the sign-in page. This needs working outbound
mail (`SMTP_URL`, `OUTBOUND_EMAIL_FROM`) — check the log for
`password_reset_email_failed` if nothing arrives. The route answers 200
either way, deliberately, so a silent failure looks identical to success from
the browser.

There is no way to set a password directly in the database: they are Argon2id
hashes, and nothing in the image will compute one for you.

### The owner lost their authenticator

Backup codes work at the two-factor challenge. If those are gone too, clear
two-factor for that account and have them enrol again immediately:

```sql
DELETE FROM two_factors
 WHERE user_id = (SELECT id FROM users WHERE email = 'owner@example.com');
UPDATE users SET two_factor_enabled = false WHERE email = 'owner@example.com';
```

### There is no usable owner in a household

Promote an existing member. This is a membership row, not a global role:

```sql
UPDATE household_memberships
   SET role = 'owner'
 WHERE household_id = (SELECT id FROM households WHERE slug = 'casa')
   AND user_id = (SELECT id FROM users WHERE email = 'member@example.com');
```

They will need to sign out and back in for the UI to catch up.

### The owner account is gone entirely

This is the one that needs `SETUP_SECRET` again. `/setup` is locked by a row,
not by a file, so reopening it is an `UPDATE`:

```sql
UPDATE app_installation
   SET status = 'pending', owner_user_id = NULL, owner_email = NULL, completed_at = NULL
 WHERE id = 1;
```

Then set `OWNER_EMAIL` (to the address of the account you want to create) and
`SETUP_SECRET` in the environment, restart the app, and visit `/setup`.

**Read this before you do it** — the setup route has two recovery paths of its
own, and they decide what actually happens:

| State of the `OWNER_EMAIL` address | What `/setup` does |
| --- | --- |
| No such user | Creates the account and a **new** household, completes the installation, signs you in |
| A user who owns at least one household | Refuses with 409 *"Setup has already been completed for this owner"*, re-marks the installation complete, and logs `setup_recovered_existing_owner`. **It will not let you take over that account** — use the password reset above instead |
| A user with no household at all (an orphan from a failed attempt) | Deletes that account and proceeds as if it were new; logs `setup_orphan_user_removed` |

So: to create a genuinely new owner, point `OWNER_EMAIL` at an address that
has no account. Setup always creates a household of its own — add the new
owner to the existing households with the promotion query above, then remove
the throwaway household from the UI if you do not want it.

Remove `SETUP_SECRET` from the environment again once you are done. The route
locks itself (409 for any secret), so keeping the secret only adds risk.

**If setup refuses with "Setup is already in progress or has been
completed"**, a previous attempt claimed the installation and crashed. The
claim expires after 10 minutes on its own; to clear it now, run the `UPDATE`
above again.

---

## 5. Rotate secrets

| Secret | How | Effect |
| --- | --- | --- |
| `AUTH_SECRET` | Change it in the environment and restart | **Every session is invalidated** — everyone signs in again. Password hashes and two-factor secrets are unaffected; the same value is hashed into the two-factor encryption key, so the enrolments survive |
| `SETUP_SECRET` | Change it in the environment and restart | None while setup is locked — it is only read by `/setup`. Remove it entirely after first run; set a new one only when reopening setup (§4) |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Rotate it in Mailgun first, then in the environment, then restart | Expect a short burst of `inbound_rejected` with `reason: signature` — messages Mailgun signed with the old key and is still retrying. They stop within Mailgun's retry window |
| SMTP credentials (`SMTP_URL`) | Change and restart | Nothing in flight to lose: mail is sent one message per connection, and a failed send is logged (`invitation_email_failed`, `password_reset_email_failed`) rather than queued |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | Change it in Postgres, then in the environment, then restart | The app fails at boot on a wrong value rather than serving with a broken pool — which is the loud failure you want |

Everything is read once at startup. There is no reload signal: a rotation is
always a restart.

---

## 6. Inbound mail stopped arriving

Work outward from the app:

1. **`GET /readyz`** — a 503 means the app cannot reach Postgres, and inbound
   mail would be answering 500. Fix that first.

2. **The app's log:**

   ```sh
   docker compose -f docker-compose.selfhost.yml logs --tail=500 app \
     | grep -E 'inbound_rejected|email_rejected|email_parse_failed|email_ingest_failed'
   ```

   - `inbound_rejected` with `reason: signature` → the signing key is wrong.
     Check that you used Mailgun's **HTTP webhook signing key**, not the API
     key.
   - `inbound_rejected` with `reason: stale` → the container's clock has
     drifted more than 5 minutes.
   - `email_rejected` with `reason: unknown_recipient` → the local part is not
     a household slug here.
   - `email_rejected` with `reason: quarantine_full` → 200 unreviewed rows;
     work through **Needs review**.
   - Nothing at all → the request never reached the app; go to step 3.

3. **Mailgun → Logs.** Every forwarded message has a line with the HTTP status
   the app answered. No line at all means Mailgun never received the mail:
   check the MX records (`dig MX <EMAIL_DOMAIN> +short` → `mxa.mailgun.org`,
   `mxb.mailgun.org`) and that the domain is verified.

4. **The route.** Confirm the forwarding URL still ends in
   `/api/inbound/mailgun/mime` and points at the current `APP_URL`. A route
   left pointing at an old hostname fails silently for eight hours per
   message.

5. **Reproduce it by hand** with the signed `curl` in
   [`inbound-mail.md`](./inbound-mail.md#testing-the-endpoint-by-hand). That
   separates "the app is refusing things" from "nothing is reaching the app"
   in one command.

---

## 7. A release failed halfway

The release pipeline tags first and publishes second, and deletes the tag
again if the publish does not finish — so a tag never points at a release that
does not exist. What it cannot undo is a **partial publish**.

GoReleaser pushes the image tags before it finishes the GitHub Release, so a
failure in between can leave the moving tags — `:latest`, `:X.Y`, `:X` —
already pointing at the new build, while the git tag has been deleted and no
GitHub Release exists. The symptom is a `docker pull …:latest` that fetches a
version with no release notes and no signed checksums.

What to do:

1. **Stop anything auto-pulling `:latest`.** Pin your deployment to the last
   known-good exact version (§1) or to its digest.
2. **Check what actually shipped**: the workflow run's summary says whether it
   reached the publish step, and the GHCR package page lists the tags and
   their push times.
3. **Re-run the release.** The version calculation is derived from
   Conventional Commits since the last tag, so with the tag deleted the next
   push to `main` — or a manual dispatch with `dry_run: false` — computes the
   same version and republishes it, moving the tags to the complete build.
   The immutable `:X.Y.Z` and `:sha-<commit>` tags are overwritten with the
   same content.
4. **Verify before trusting it again**: `cosign verify` on the image and
   `cosign verify-blob` on `checksums.txt` — the "Verifying a release" section
   of the [README](../README.md#verifying-a-release). An unsigned image is a
   publish that did not finish.

A run that was **cancelled** rather than failed is covered by the same
cleanup, deliberately: a cancelled job is not a failed one, and the tag
deletion keys on the publish step's own outcome so a timeout or a manual
cancel between tag and publish still removes it.

---

## 8. Service worker, icons and sessions

The SPA registers `/sw.js`. It caches only the app shell and the
content-hashed files under `/assets/`; `/api/*` is never intercepted, so
sessions, inbox data and codes always come from the network. Navigations are
network-first, so a new release is picked up on the next open.

- If you change the caching strategy, bump `CACHE_NAME` in
  `apps/frontend/public/sw.js` so the `activate` handler drops the old cache
  on every device.
- Icons in `apps/frontend/public/icons/` are generated from
  `assets/mi-casa-su-casa-logo.png`. No build step depends on them;
  regenerate by hand if the logo changes.
- Sessions last 30 days with a daily sliding refresh. Members can revoke any
  session from **Settings → Signed-in devices**; rotating `AUTH_SECRET`
  invalidates all of them at once (§5).
