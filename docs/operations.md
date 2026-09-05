# Operations: observability and alerting

Mi Casa Su Casa runs as one container. Everything it reports goes to
**stdout** — one JSON object per line — so it lands wherever the container
runtime points the stream: `docker compose logs`, `kubectl logs`, Loki,
CloudWatch, a file. There is no logging configuration in the app beyond
`LOG_LEVEL`, which is currently parsed and validated but does not yet filter
anything: every event line is written.

Request URLs are never logged in full. Invitation and password-reset links
carry one-time secrets, so a failure line records the **path only**, never the
query string, and the invitation API takes its token in the
`X-Invitation-Token` header rather than in the URL.

See also: [`runbook.md`](./runbook.md) for what to do when one of these fires,
and [`inbound-mail.md`](./inbound-mail.md) for the inbound pipeline in detail.

## Log events

Every line is `{"event": "<name>", "level": "info|warn|error", ...fields}`.
There is no timestamp field — every consumer stamps its own receive time, and
two clocks that disagree by milliseconds only cause arguments. **Message
bodies and verification codes are never logged.**

| Event | Level | When | Key fields |
| --- | --- | --- | --- |
| `api_request_failed` | warn / error | any response ≥ 400 through the API chain (5xx is error) | `method`, `path`, `status`, `durationMs`, `requestId` |
| `unhandled_error` | error | an unexpected error or a panic reached the global handler (the response is a JSON 500) | `method`, `path`, `error`, `during`, `requestId` |
| `inbound_rejected` | warn | a Mailgun webhook POST failed the guards (401) | `reason` (`signature`, `stale`, `replay`, `malformed`), `path` |
| `email_stored` | info | inbound mail matched a sender rule and was stored | `from`, `to`, `rawSize`, `messageId`, `householdId`, `providerKey`, `codeFound`, `truncated` |
| `email_quarantined` | info | inbound mail was held for review | `from`, `to`, `rawSize`, `messageId`, `householdId`, `reason`, `truncated` |
| `email_rejected` | info | mail refused permanently (406) | `reason` (`unknown_recipient`, `too_large`, `quarantine_full`), `from`, `to`, `max` / `pending` |
| `email_parse_failed` | error | the message was not parseable as MIME, or carried no `body-mime` (406) | `from`, `to`, `rawSize`, `error` |
| `email_ingest_failed` | error | storing the message failed, or a panic escaped the webhook handler (500 — the sender retries) | `from`, `to`, `messageId`, `error` |
| `invitation_email_failed` | error | an invitation could not be delivered (the invitation is still created, with a copyable link) | `invitationId`, `to`, `error` |
| `password_reset_email_failed` | error | a reset link could not be delivered (the route still answers 200, so it cannot be used to probe which addresses have accounts) | `to`, `error` |
| `invitation_accept_failed` | error | a step of invitation acceptance failed; a half-made account is rolled back | `invitationId`, `during`, `error` |
| `retention_completed` | info | the nightly purge finished | `scheduledFor`, `messagesPurged`, `quarantinePurged`, `batches`, `durationMs` |
| `retention_failed` | error | the purge did not finish — nothing was recorded, so `/readyz` goes stale | `scheduledFor`, `durationMs`, `error` |
| `setup_failed` | error | first-run setup failed and was compensated | `userId`, `during`, `error` |
| `setup_cleanup_failed` | error | the compensation itself failed — the installation may be stuck `in_progress` | `userId`, `during`, `error` |
| `setup_recovered_existing_owner` | warn | an interrupted earlier setup had already created the owner; the bookkeeping was finished instead | `userId` |
| `setup_orphan_user_removed` | warn | an interrupted earlier setup left an account with no household; it was removed so the retry can proceed | `userId` |
| `member_removed` | info | an owner removed a member | `householdId`, `userId`, `byUserId` |
| `member_left` | info | a member left a household | `householdId`, `userId` |

Two things that are **not** JSON event lines:

- **Boot and shutdown lines.** Startup writes plain text: the listening
  address, the scheduler's job table (only in the modes that schedule), and a
  summary of `APP_URL`, `EMAIL_DOMAIN`, `ENVIRONMENT` and the outbound relay
  with its password redacted. Shutdown writes `SIGTERM received, shutting
  down`. These are for a human scrolling up, and they answer "is this replica
  the one running the nightly purge?" without a query.
- **`audit_write_failed`.** An audit row that could not be written is a plain
  log line, not a structured event: the action itself succeeded, and the
  failure must not change what the caller was told. Grep for the literal
  string.

Owner and admin actions are additionally stored in the `audit_events` table
and exposed to owners at `GET /api/admin/:slug/audit`.

### Useful queries

Whatever indexes your stream, these are the filters worth saving:

```
event="inbound_rejected"                      # the webhook is being refused
event="email_rejected" OR event="email_parse_failed" OR event="email_ingest_failed"
event="retention_failed"                      # the purge stopped working
level="error"                                 # everything the app could not handle
```

To follow one request end to end, filter on `requestId`. It is the caller's
`X-Request-Id` when a proxy set one, and otherwise a random id minted for that
request — either way, `api_request_failed` and any `unhandled_error` from the
same request carry the same value.

## Health endpoints

Both are unauthenticated and sit outside the API's middleware chain.

- **`GET /healthz`** — liveness. Answers `{"ok":true}` and touches nothing,
  not even the database pool, so a Postgres outage can never turn "the process
  is up" into a restart loop. Present in every dispatch mode, including
  `worker`, which serves this route and nothing else. The image's own
  `HEALTHCHECK` probes it by running `/app/mi-casa healthcheck` — there is no
  shell or curl in the image to do it any other way.

- **`GET /readyz`** — readiness. Reads the installation singleton, which does
  double duty: the round trip proves Postgres is reachable, and the row
  carries the retention job's last success.

  ```json
  {"ok":true,"status":"ready","setupConfigured":true,
   "retention":{"lastRunAt":"2026-09-04T03:00:11.412Z","stale":false}}
  ```

  `retention.stale` is `true` until the job has succeeded once (a fresh
  install), and whenever the last success is more than **48 hours** old — one
  missed nightly run plus a full day of slack. A failed database read answers
  **503** with `{"ok":false,"error":"database unavailable"}`; the driver's own
  error, which names the host, port, database and user, goes to the log rather
  than to an unauthenticated caller.

## Minimum alert set

Four things, in the order they matter:

1. **An uptime monitor on `https://<APP_URL>/readyz`**, alerting on any
   non-200. This is the single most valuable check: it covers the process, the
   proxy, TLS and the database in one request.

2. **The same monitor asserting on the body**, if it can: alert when
   `retention.stale` is `true`. A retention job that silently stopped means
   mail — and the one-time codes in it — is no longer purged after 30 days,
   and nothing else will tell you.

3. **A log alert on the error events**: `retention_failed`,
   `email_ingest_failed`, `unhandled_error`. Each of these is something that
   should not happen twice, and each has a runbook entry.

4. **A log alert on sustained `inbound_rejected`.** A handful after a key
   rotation or a Mailgun retry is normal (see
   [`inbound-mail.md`](./inbound-mail.md)); a steady stream means every
   incoming message is being refused and the household is silently receiving
   nothing at all.

Worth watching but not worth waking up for: `invitation_email_failed` and
`password_reset_email_failed` (the relay is misconfigured — an invitation
survives as a copyable link, a password reset does not), and a rising rate of
`api_request_failed` with `status: 429`.

If your platform has a container restart alert, enable it. The app exits
non-zero on a configuration error and on a listener that cannot bind, so a
crash loop right after a deploy is almost always a bad environment variable —
and the reason is in the last line before the exit, listing every problem at
once.

## Rate limiting

Two limiters, both keyed on a **keyed digest of the client address**, never
the address itself. Which address that is depends on `TRUSTED_PROXY_HOPS`: at
`0` the socket's peer address is used and `X-Forwarded-For` is ignored
entirely, because it is caller-supplied. Behind a proxy, set it to the number
of proxies in front or every client shares one bucket.

The auth routes (the auth library's own limiter, in-process):

| Route | Budget |
| --- | --- |
| `/api/auth/signin/credential` | 5 per minute |
| `/api/auth/passwords/request-reset` | 3 per 5 minutes |
| `/api/auth/passwords/reset` | 5 per 5 minutes |
| `/api/auth/two-factor/verify` | 5 per minute |
| everything else under `/api/auth/` | 60 per minute |

The app's own routes (a Postgres-backed limiter, so the budget is shared
across replicas):

| Rule | Routes | Budget |
| --- | --- | --- |
| `setup` | `POST /api/setup/complete` | 5 per 15 minutes |
| `invitations` | `GET /api/invitations/lookup`, `POST /api/invitations/accept` | 20 per 10 minutes |
| `household-create` | `POST /api/households` | 10 per hour |

A refusal answers **429** with a `Retry-After` header and shows up as
`api_request_failed` with `status: 429`. Repeated 429s on `/api/setup/complete`
or `/api/auth/signin/credential` from one caller are somebody probing; the fix
is a rate-limiting rule at the proxy, not in the app.

The Postgres limiter's expired counters are swept by the nightly retention job
— another reason a stale retention job matters. The auth limiter is
in-process, so with several replicas each one carries its own budget; a
deployment that cares should put a rate limit in front of `/api/auth/`.

The inbound webhook is deliberately **not** rate-limited: it is authenticated
by signature, Mailgun posts from a small set of addresses, and each request is
bounded to a little over 2 MiB before it is read at all.
