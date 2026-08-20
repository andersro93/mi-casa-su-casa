# Operations: observability and alerting

Mi Casa Su Casa runs as one Cloudflare Worker. Everything it reports goes to **Workers Logs** (enabled in `wrangler.jsonc` → `observability.logs`) as single-line JSON, and to Cloudflare's built-in Worker metrics.

## Log events

Every line is `{"event": "<name>", "level": "info|warn|error", ...fields}`. Bodies and verification codes are never logged.

| Event | Level | When | Key fields |
| --- | --- | --- | --- |
| `api_request_failed` | warn / error | any `/api/*` response ≥ 400 (5xx = error) | `ray`, `method`, `path`, `status`, `durationMs` |
| `unhandled_error` | error | an exception reached the global handler (response is a JSON 500) | `ray`, `method`, `path`, `error` |
| `env_misconfigured` | error | a request hit a Worker missing required config (503) | `problems[]` |
| `email_stored` / `email_quarantined` | info | inbound mail processed | `from`, `to`, `messageId`, `householdId`, `providerKey`, `codeFound`, `truncated` |
| `email_rejected` | info | mail refused (`unknown_recipient`, `too_large`, `quarantine_full`) | `reason`, `from`, `to` |
| `email_parse_failed` / `email_ingest_failed` | error | parsing or storage failed (ingest failures are re-thrown so the sender retries) | `from`, `to`, `messageId`, `error` |
| `invitation_email_failed` / `password_reset_email_failed` | error | outbound email could not be sent | `invitationId` / `userId`, `error` |
| `retention_completed` / `retention_failed` | info / error | daily cron result | `messagesPurged`, `quarantinePurged`, `batches`, `durationMs` |
| `setup_failed`, `setup_orphan_user_removed`, `setup_recovered_existing_owner`, `setup_cleanup_failed` | error / warn | first-run setup recovery paths | `userId`, `error` |
| `invitation_accept_failed` | error | membership step failed after sign-up (account rolled back) | `invitationId`, `error` |
| `member_removed`, `member_left` | info | membership changes | `householdId`, `userId`, `byUserId` |
| `audit_write_failed` | error | an audit row could not be written (the action itself succeeded) | `action`, `error` |

Owner/admin actions are additionally stored in the `audit_events` table and exposed to owners at `GET /api/admin/:slug/audit`.

### Useful Workers Logs queries

- Ingestion problems: `event:"email_ingest_failed" OR event:"email_parse_failed" OR event:"email_rejected"`
- Anything the Worker could not handle: `level:"error"`
- One request end-to-end: filter by `ray` (the `cf-ray` header the client received)

## Health endpoints

- `GET /api/health/live` — always 200 while the Worker runs.
- `GET /api/health/ready` — 503 with `problems[]` when required config is missing; otherwise 200 with `setupConfigured` and `retention: { lastRunAt, stale }` (`stale` is true until the first cron run and whenever the last run is older than 48 h).

## Minimum alert set

1. **Cloudflare Notifications → Workers** — enable *Error rate* (and *CPU / request limits* if on the free plan) for the production Worker.
2. **Cloudflare Notifications → Cron Triggers** — *Failed cron trigger* for the production Worker (the retention job re-throws on failure so it registers).
3. **External uptime monitor** (any provider) on `https://<APP_URL>/api/health/ready`, alerting on non-200 **and** on `retention.stale == true` if the monitor supports body assertions.
4. **Workers Logs alert / Logpush rule** on `event:"email_ingest_failed"`, `event:"env_misconfigured"` and `event:"unhandled_error"`. Without Logpush, check the Logs tab after any report of a missing code.

## Rate limiting and abuse

Brute-force limits are enforced in D1 (see README → Security notes). Repeated `api_request_failed` lines with `status: 429` for the same `ray` prefix / path indicate someone probing sign-in, setup or invitation endpoints; consider adding a Cloudflare WAF rate-limiting rule in front of `/api/auth/*` and `/api/setup/*`.
