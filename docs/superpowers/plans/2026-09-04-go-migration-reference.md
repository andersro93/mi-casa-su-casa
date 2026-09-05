# Go Migration Reference — Backend Inventory & Limen Integration

This document is the **parity contract** for the Go rewrite of Mi Casa Su
Casa. Part A is a verified inventory of the TypeScript Workers backend as of
commit `114d96b` (`src/server`, `src/index.ts`). Part B is a source-verified
integration guide for Limen (the Go auth library) and its TypeScript client.
Part C records the Mailgun inbound contract. Implementation tasks in
`2026-09-04-go-backend-migration.md` cite sections of this file as REF §…;
when in doubt the TypeScript source is ground truth and this file is the map
to it.

Passkeys are **dropped** in the rewrite (design spec). Inventory entries that
mention passkeys document today's behaviour; the plan removes them.

---

# Part A — TypeScript Backend Inventory

## A1. HTTP surface and middleware order (`src/index.ts`)

1. Security headers on every response (SPA, assets and API):
   - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
   - `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
     `X-Content-Type-Options: nosniff`,
     `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
   - Hono's secureHeaders also sets `X-XSS-Protection: 0`,
     `Cross-Origin-Opener-Policy: same-origin`,
     `Cross-Origin-Resource-Policy: same-origin`, `X-DNS-Prefetch-Control: off`,
     `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`.
     Go: set the first list; the second is nice-to-have and covered by a test
     only for `X-Content-Type-Options`, `X-Frame-Options`, CSP, HSTS,
     `Referrer-Policy`.
2. CORS on `/api/*` for `APP_URL` origin only (and `http://localhost`/
   `127.0.0.1` when `ENVIRONMENT=development`). Go: **no CORS middleware**
   (same-origin SPA). Test that a foreign `Origin` on a GET gets no
   `Access-Control-Allow-Origin` header.
3. `rejectCrossSiteMutations` on `/api/*` (`src/server/security/origin.ts`):
   for non-GET/HEAD/OPTIONS, reject with `403 {"error":"Cross-site request
   rejected"}` when (a) `Sec-Fetch-Site` is present and not `same-origin`/
   `none` and `Origin` is absent or not the app origin; or (b) `Origin` is
   present and not the app origin; or (c) `Origin` absent but `Referer`
   present with a foreign origin. Requests with none of the headers pass.
4. `logFailedApiRequests`: one JSON log line per API response with status
   ≥ 400: `{event:"api_request_failed", level:"warn"|"error"(≥500), method,
   path, status, durationMs, ray}`. Go: same fields, `ray` becomes a
   per-request id (`X-Request-Id` if present, else random).
5. Env guard on `/api/*` except `/api/health/live`: `503 {error:
   "misconfigured", problems:[{key,message}]}`. Go: config is validated at
   boot, so this middleware does not exist; `/readyz` reports readiness.
6. `loadAuthSession` on `/api/inbox/*`, `/api/admin/*`, `/api/households/*`,
   `/api/settings/*` (and inside `/api/invitations`): resolves the session
   and sets `user = {id, email, name (falls back to email), role, households:
   HouseholdSummary[]}`, `session = {id, userId}`.
7. Auth handler on `/api/auth/*` (Better Auth; Go: Limen, see Part B).
8. Route groups: `/api/health`, `/api/households`, `/api/inbox`,
   `/api/admin`, `/api/invitations`, `/api/settings`, `/api/setup`.
9. Unmatched `/api/*` → `404 {"error":"Not found"}` (never the SPA).
10. Everything else → static assets with SPA fallback to `index.html`.
11. Error handler (`src/server/http/errors.ts`): unique violations →
    `409 {"error":"A record with the same <column> already exists"}` (column
    from the constraint name's last dotted segment, underscores → spaces);
    HTTPException → its status and message; anything else → log
    `unhandled_error` and `500 {"error":"Internal error"}`.

**Error envelope**: `{ "error": string }`, optionally `"fields":
{field: message}` on validation errors and `"code": "ACCOUNT_EXISTS"` on one
invitation error. Go keeps exactly this shape.

**Validation** (`src/server/http/validation.ts`): invalid JSON →
`400 {"error":"Invalid JSON body"}`; schema failure → `400 {error: "<summary>",
fields: {path: firstMessage}}` where summary joins `"<path>: <message>"` (or
just the message when it already starts with the path) with `"; "`. Go: the
same envelope, produced from kin-openapi validation errors plus hand
validation for cross-field rules (sender rule shape, slug rules).

### Auth guards (`src/server/auth/middleware.ts`)

- `requireAuthenticatedUser`: no user → `401 {"error":"Unauthorized"}`.
- `requireHouseholdContext`: no user → 401; missing slug → 400 `"Household
  slug is required"`; user not a member of `:slug` → `403 {"error":
  "Forbidden"}`; else sets `household = {id, slug, role}`.
- `requireOwner`: `household.role !== "owner"` → `403 {"error":"Forbidden"}`.

### Rate limiting (`src/server/security/rate-limit.ts`)

Fixed window per `app:<rule>:<client>` key in table `rate_limit`
(`key` unique, `count`, `last_request` epoch ms). Over limit → `429
{"error":"Too many requests. Please try again later."}` with `Retry-After`
seconds. Rules: `setup` 5 per 15 min; `invitations` 20 per 10 min (both
lookup and accept); `household-create` 10 per hour. Client = trusted client
address (Go: `ratelimit.ClientIP(xForwardedFor, remoteAddr, TRUSTED_PROXY_HOPS)`
digested with SHA-256 keyed by `AUTH_SECRET` + `"mi-casa/ip"`; never stored raw).

## A2. Routes

Every handler below runs after the middleware in A1. `:slug` routes require
membership; owner-only routes are marked **owner**. Response bodies are
verbatim from the TS source; snake_case keys are deliberate (the SPA reads
them).

### Health (`src/server/routes/health.ts`)

| Method | Path (TS → Go) | Response |
|---|---|---|
| GET | `/api/health/live` → `/healthz` | TS: `{status:"ok"}`; Go: `{ok:true}` (Pjokk convention; SPA does not call it) |
| GET | `/api/health/ready` → `/readyz` | 200 `{ok:true, status:"ready", setupConfigured:bool, retention:{lastRunAt: string|null, stale: bool}}`; `stale` = no run recorded or older than 48 h. 503 `{ok:false, error}` when `SELECT 1` fails |

### Setup (`src/server/routes/setup.ts`) — public

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/setup/status` | `{needsSetup, setupLocked, isConfigured, status, emailDomain}`. `isConfigured` = OWNER_EMAIL and SETUP_SECRET set (always true in Go, both required); `needsSetup` = configured and status ≠ complete; `setupLocked` = status = complete; `emailDomain` = EMAIL_DOMAIN. |
| POST | `/api/setup/complete` | rate `setup`. Body `{email, name, password, householdName, householdSlug, setupSecret}` (schemas A4). Order: 409 `"Setup has already been completed"` if complete; 503 if unconfigured (never in Go); validate; 403 `"Invalid setup secret"` (constant-time compare); 403 `"Setup email must match OWNER_EMAIL"` (case-insensitive); claim via `beginInstallationSetup` else 409 `"Setup is already in progress or has been completed"`; if a user with OWNER_EMAIL exists: owner of ≥1 household → complete installation, 409 `"Setup has already been completed for this owner. Sign in with your owner account."`; else delete the orphan user. Then create user (sign-up), create household with owner membership, complete installation (`owner_user_id`, `owner_email`), audit `installation.setup_completed` (target `installation`/`"1"`, details `{householdSlug}`), respond `201 {member:{id,email,name,role:"owner"}, household}` **with the session cookie set**. On failure: delete the created user, `resetInstallationSetup`, 409 `"A household with that slug already exists"` on unique violation, else the auth error's status/message, else 500 `"Unable to complete setup"`. |

Installation state (`app_installation`, singleton id=1, seeded `pending` on
first read): `beginInstallationSetup` moves pending→in_progress, or reclaims
an in_progress older than 10 minutes; `completeInstallationSetup` sets
complete + owner; `resetInstallationSetup` in_progress→pending only when
`owner_user_id IS NULL`; `recordRetentionRun` sets `last_retention_run_at`.

### Households (`src/server/routes/households.ts`) — session required

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/households/me` | `{households: HouseholdSummary[]}` ordered by lower(displayName). `HouseholdSummary = {id, slug, displayName, role}` |
| POST | `/api/households` | rate `household-create`. Body `{slug, displayName}`. May create when: installation owner, or user has zero memberships (TS also allows `user.role === "admin"`; Go has no such role). Else 403 `"Only the installation owner can create additional households. Ask them to create it and invite you."`. Slug taken → 409 `"Household slug already exists"`. Creates household + owner membership atomically, audit `household.created` (details `{slug}`), `201 {household: {...HouseholdSummary-with-createdAt/updatedAt, role:"owner"}}` |
| POST | `/api/households/:slug/leave` | member. Sole owner → 409 `"You are the only owner of this household. Make another member an owner first."`. Removes membership (provider access cascades), log `member_left`, audit `member.left` (target user), `{ok:true}` |

### Inbox (`src/server/routes/inbox.ts`) — member of `:slug`

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/inbox/:slug/providers` | `{providers: ProviderSummaryRow[]}` — providers the user may see (owner: all; member: those with provider access), each `{household_slug, provider_key, display_name, message_count, new_count, latest_received_at, latest_message_id, latest_subject, latest_code, latest_status}` ordered by latest activity desc then display_name |
| GET | `/api/inbox/:slug/providers/:providerKey?limit&before` | member without access → 403; unknown provider → 404 `"Provider not found"`. `{provider:{providerKey, displayName}, messages: InboxMessageRow[], page:{limit, nextBefore}}`. Keyset pagination: `limit` 1..200 default 50, `before` ISO timestamp; fetch limit+1 to compute `nextBefore` = last item's `received_at`. `InboxMessageRow = {id, household_slug, provider_key, provider_display_name, subject, from_header, text_body, extracted_code, status, received_at}` |
| PATCH | `/api/inbox/:slug/messages/:messageId/status` | 404 `"Message not found"`; member without access to the message's provider → 403; body `{status: new|used|expired}`; `{message: InboxMessageRow}` |
| GET | `/api/inbox/:slug/quarantine?limit&before` | **owner**. `{messages: QuarantineMessageRow[], page}`; rows unreviewed only; `QuarantineMessageRow = {id, household_slug, provider_key:"quarantine", provider_display_name:"Quarantine", subject, from_header, envelope_from, text_body, extracted_code, status:"new", quarantine_reason, received_at}` |
| POST | `/api/inbox/:slug/quarantine/:messageId/review` | **owner**. Body `{action: dismiss|release, providerKey?}`. release without providerKey → 400 `"providerKey is required to release a message"`; unknown provider → 404 `"Provider not found"`; unknown or already reviewed message → 404 `"Quarantine message not found"`. Release inserts a copy into `messages` (status new, classification_reason `"Released from quarantine by owner review. Original reason: <reason>"`, same received_at/delete_after, `ON CONFLICT DO NOTHING` on (household_id, message_id)) and marks reviewed, in one transaction. Response `{reviewedAt, releasedMessage: InboxMessageRow|null}`. Audit `quarantine.dismiss`/`quarantine.release` (target quarantine_message, details `{providerKey}` when present) |

### Admin (`src/server/routes/admin/*`) — **owner** of `:slug`

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/admin/:slug/audit` | `{events: AuditEventRecord[]}` newest 100; `{id, actorUserId, householdId, action, targetType, targetId, details (parsed JSON or null), createdAt}` |
| GET | `/api/admin/:slug/settings` | `{household: {slug, displayName, emailAddress}}`; `emailAddress = slug@EMAIL_DOMAIN` |
| PATCH | `/api/admin/:slug/settings` | body `{displayName}`; updates, audit `household.settings_updated` (details `{displayName}`); same response |
| GET | `/api/admin/:slug/providers` | `{providers: ProviderConfigurationRow[], rules: SenderRuleRow[]}`; providers `{id, household_id, provider_key, display_name, created_at, rule_count}` by display_name; rules `{id, household_id, provider_id, match_type, match_value, created_at}` by created_at, match_value |
| POST | `/api/admin/:slug/providers` | body `{providerKey, displayName}`; key taken → 409 `"Provider key already exists"`; `201 {provider: ProviderRow}`; audit `provider.created` |
| PATCH | `/api/admin/:slug/providers/:providerId` | 404 `"Provider not found"`; key conflict with another → 409; `{provider}`; audit `provider.updated` |
| DELETE | `/api/admin/:slug/providers/:providerId` | 404; cascades rules, messages, access; `{ok:true}`; audit `provider.deleted` |
| POST | `/api/admin/:slug/provider-rules` | body `{providerId, matchType, matchValue}`; provider not in household → 404 `"Provider not found"`; `201 {rule}`; duplicate (household, type, value) → 409 via error handler; audit `sender_rule.created` |
| PATCH | `/api/admin/:slug/provider-rules/:ruleId` | 404 provider / 404 `"Sender rule not found"`; `{rule}`; audit `sender_rule.updated` |
| DELETE | `/api/admin/:slug/provider-rules/:ruleId` | 404; `{ok:true}`; audit `sender_rule.deleted` |
| GET | `/api/admin/:slug/members` | `{members: [{id, householdRole, email, name, role, createdAt, updatedAt, providerAccess:[{providerKey, displayName}]}], providers: ProviderRow[]}`; members ordered by user created_at. (`role` duplicates `householdRole`; the TS `role` column is Better Auth's global role — Go returns `householdRole` in both) |
| POST | `/api/admin/:slug/members` | body `{email, name, role}` → same as creating an invitation with no provider scope (below) |
| DELETE | `/api/admin/:slug/members/:userId` | self → 400 `"Use 'Leave household' to remove yourself."`; not a member → 404 `"Member not found"`; last owner → 409 `"A household must keep at least one owner."`; remove; log `member_removed`; audit `member.removed`; `{ok:true}` |
| PATCH | `/api/admin/:slug/members/:userId/role` | self → 403 `"Cannot change your own role. Ask another admin."`; body `{role}`; 404; update; audit `member.role_changed` (details `{role}`); `{ok:true}` |
| POST | `/api/admin/:slug/members/:userId/provider-access` | body `{providerKey}`; 404 provider / 404 member; grant (idempotent); audit `member.provider_access_granted`; `{ok:true}` |
| DELETE | `/api/admin/:slug/members/:userId/provider-access/:providerKey` | (TS also accepted a JSON body without the path param; Go: path param only, spec-validated); 404s; revoke; audit `member.provider_access_revoked`; `{ok:true}` |
| GET | `/api/admin/:slug/invitations` | first expires pending invitations past `expires_at` for this household; `{invitations: Invitation[]}` newest first; `Invitation = {id, householdId, email, name, role, status, invitedByUserId, acceptedByUserId, expiresAt, acceptedAt, cancelledAt, createdAt, updatedAt, providers:[{id, provider_key, display_name}]}` |
| POST | `/api/admin/:slug/invitations` | body `{email, name, role="member", providerIds=[]}`; any providerId outside the household → 400 `"One or more selected providers do not belong to this household"`; creates (A3 invitations); `201 {invitation, inviteUrl, emailSent, emailError?}`; audit `invitation.created` (details `{email, role, emailSent}`) |
| POST | `/api/admin/:slug/invitations/:invitationId/resend` | expires stale first; not pending → 404 `"Invitation not found or not resendable"`; cancels old, creates new with same email/name/role/providers; `200 {invitation, inviteUrl, emailSent, emailError?}`; audit `invitation.resent` (details `{email, replaces, emailSent}`) |
| DELETE | `/api/admin/:slug/invitations/:invitationId` | 404 `"Invitation not found"`; sets cancelled; audit `invitation.cancelled`; `{ok:true}` |

### Invitations (`src/server/routes/invitations.ts`) — public, rate `invitations`

Token travels in header `X-Invitation-Token` (never in the URL). Missing →
`400 {"error":"Invitation token header is required"}`. Lookup by SHA-256 hex
of the token.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/invitations/lookup` | not pending → 404 `"Invitation not found or no longer valid"`; expired → 410 `"This invitation has expired"`; `{invitation, household:{displayName}|null, invitedBy:{name}|null, accountExists, viewer: {email, emailMatches}|null}` |
| POST | `/api/invitations/accept` | same 404/410. Signed-in user: email mismatch (case-insensitive) → 403 `"You are signed in as a different account. Sign out and accept the invitation with the invited email address."`; else accept as that user → `200 {member:{id,email,name,role}, household}`. Anonymous: body `{name, password}` required (400 with `"<path>: <message>"` on failure, `"Invalid JSON body"` on bad JSON); account for the email exists → `409 {error:"An account with the invited email already exists. Sign in with it, then open the invitation link again.", code:"ACCOUNT_EXISTS"}`; else create user, accept → `201 {member, household}` **with session cookie**. Failure after user creation deletes the user; auth errors pass through with their status; else 500 `"Unable to accept invitation"` |

`acceptInvitation` (repository): upsert membership with the invitation's
role, mark invitation accepted (`accepted_by_user_id`, `accepted_at`), copy
invitation provider scope into `household_member_provider_access`
(idempotent) — one transaction.

### Settings (`src/server/routes/settings.ts`) — session required

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/settings` | `{profile: {id, email, name, image, role, twoFactorEnabled, households: HouseholdSummary[]}, sessions: [{id, isCurrent, expiresAt, ipAddress, userAgent, createdAt, updatedAt, impersonatedBy}]}` newest session first. Go: `role` is `null`, `impersonatedBy` is `null`, `ipAddress` is the stored digest (opaque) |
| GET | `/api/settings/households` | `{households: HouseholdSummary[]}` |
| PATCH | `/api/settings/profile` | body `{name, image?}` (image "" → null); `{profile}` |
| DELETE | `/api/settings/sessions/others` | revokes every other session; audit `session.revoked_others` (no household); `{ok:true}` |
| DELETE | `/api/settings/sessions/:sessionId` | revokes that session if it belongs to the user (silently no-op otherwise); audit `session.revoked` (target session); `{ok:true}` |

### Inbound mail (Go only)

| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/inbound/mailgun/mime` | Part C. Not in the OpenAPI spec (multipart form from a third party); mounted directly and excluded from the same-site check (Mailgun sends no Origin). |

## A3. Domain rules

### Household slug (`src/server/domain/household-slug.ts`)

Lower-case, 2..40 chars, `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`, not in the
reserved set: `api admin assets cdn-cgi favicon.ico forgot-password health
households household inbox invite invitations login logout members
new-household postmaster providers quarantine reset-password settings setup
static two-factor abuse noreply no-reply hostmaster webmaster`. Go adds
`healthz readyz`. Error messages: `"slug is required"`, `"slug must be
between 2 and 40 characters"`, `"slug may only contain lowercase letters,
numbers, and hyphens, and must start and end with a letter or number"`,
`"\"<slug>\" is reserved and cannot be used as a household slug"`.

### Invitations (`src/server/domain/invitations.ts`)

- Token = random UUID; stored as SHA-256 hex (`token_hash`, unique).
- TTL 7 days; `invite URL = APP_URL(without trailing slash)/invite/<token>`.
- Email delivery failure is **not** an error: `{emailSent:false, emailError}`
  plus log `invitation_email_failed`; the owner shares the link manually.
- Resend = cancel + create with the same email, name, role, providers.

### Classification (`src/server/domain/classify-email.ts`)

`classifyEmail(parsed)`:
1. `code = extractVerificationCode(textBody)` (always computed).
2. No `householdSlug` → quarantine `{householdId:null, reason:"No household
   slug could be resolved from the recipient address."}`.
3. Slug not found → quarantine `{householdId:null, reason:"No household
   matched the inbound recipient address."}`.
4. `findProviderMatch(householdId, candidates)` where candidates are
   `[fromAddress (source "header") if present, envelopeFrom (source
   "envelope")]`, trimmed, lower-cased, de-duplicated. Exact rules first
   (any candidate, in order), then domain rules (domain equals or candidate
   domain ends with `.` + rule value; longest rule wins). No match →
   quarantine `"No sender rule matched the inbound email within the
   addressed household."`.
5. `authenticationVerdict(auth, matchedSource)`: `auth == nil` → trusted;
   `dmarc=fail` → untrusted `"dmarc=fail"`; header source needs
   `dkim=pass` or `dmarc=pass` else `"From header not authenticated
   (dkim=<v|none>, dmarc=<v|none>)"`; envelope source needs `spf=pass` else
   `"envelope sender not authenticated (spf=<v|none>)"`. Untrusted →
   quarantine `"Sender <addr> matched provider <key> but sender
   authentication failed: <reason>."`.
6. Matched → `{kind:"matched", householdId, householdSlug, providerId,
   providerKey, code, reason}` with reason `"Sender matched a configured rule
   and a likely verification code was found."` when code ≠ null else
   `"Sender matched a configured rule."`.

### Code extraction (`src/server/domain/extract-code.ts`)

Port verbatim, including the regexes:
- keyword pattern (case-insensitive, word-bounded):
  `(?:(?:verification|verify|security|one[- ]?time|login|log-?in|sign[- ]?in|access|confirmation|auth(?:entication|orization)?|2fa|two[- ]factor)\s+(?:code|pin|passcode|password|otp)|passcode|otp|pin\s+code|code|kode|c[oó]digo|codice)`
- window: 80 chars after each keyword; token scan `[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]|[A-Za-z0-9]`;
  a token is rejected when the 2 chars before it end with `#$€£+%` or `&#`.
- a token run is split at digit/non-digit boundaries on space or hyphen,
  each piece tried, then each single sub-token.
- `codeFromChunk`: `^(\d{3,4})[ -](\d{3,4})$` → joined; all digits → 4..8
  long and not `19xx`/`20xx`; `^[A-Z0-9]{5,10}$` with ≥1 digit and ≥1
  uppercase letter → itself; else null.
- fallback without keyword: collect distinct `\b(\d{3}[ -]\d{3}|\d{6})\b`
  (normalised, not year-like, not symbol-preceded); exactly one → it.
- Go regexp has no lookbehind: implement the split with a small loop over
  runes instead of the `(?<=…)` regex.

Test cases (`test/extract-code.test.ts`), all must pass in Go:

| input | expected |
|---|---|
| `Your verification code is 654321` | `654321` |
| `Your verification code is valid for 10 minutes: 482913` | `482913` |
| `Your verification code will expire soon.\n\n482913` | `482913` |
| `Enter the security code below to continue\n\n771122` | `771122` |
| `Your code: 123-456` | `123456` |
| `Your code is 123 456` | `123456` |
| `Ihr Code lautet 123456` | `123456` |
| `Tu código de verificación es 998877` | `998877` |
| `OTP: 4821` | `4821` |
| `Your one-time passcode is 7K3PQ2` | `7K3PQ2` |
| `Sign-in code\n\n445566\n\nThis code expires in 5 minutes.` | `445566` |
| `Use this PIN code 2468 to unlock` | `2468` |
| `Use 112233 to finish signing in` | `112233` |
| `Welcome back, there is nothing to verify here.` | null |
| `© 2024 Netflix, Inc. 100 Winchester Circle, Los Gatos, CA 95032` | null |
| `Order #123456 has shipped. Track it at 555 0100 ext 4433` | null |
| `Two codes 111111 and 222222 are both in here` | null |
| `Your code is valid until 2026. Thanks!` | null |
| `Promo code SUMMER applies; nothing numeric` | null |

### Email parsing (`src/server/email/parse.ts`)

`ParsedIncomingEmail = {envelopeFrom, envelopeTo, householdSlug (local part
of envelopeTo lower-cased if it matches ^[a-z0-9-]+$ else null), fromHeader
(raw From header), fromAddress (lower-cased address from From, or null),
authentication {spf,dkim,dmarc}|null, subject|null, messageId (Message-ID
header or synthetic `<synthetic-<first 32 hex of sha256(from\0to\0date\0subject\0body)>@mi-casa-su-casa>`),
dateHeader|null, textBody, textBodyTruncated, rawSize}`.

- textBody = trimmed text part, else `stripHtml(html)`, else
  `"[empty email body]"`; cut at 65536 chars with `"\n[truncated]"` appended.
- `stripHtml`: remove comments and `style|script|head|title` blocks, tags →
  space, decode entities (`&nbsp;`→space, `&amp; &lt; &gt; &quot; &apos;
  &#39;`, numeric and hex), collapse whitespace, trim.
- `parseAuthenticationResults(values)`: first `spf=|dkim=|dmarc=<word>`
  per mechanism across all `Authentication-Results` headers, lower-cased;
  null when there are no such headers.
- Go adds Mailgun headers (Part C) as the primary source of spf/dkim.

### Message storage (`src/server/db/repositories/messages.ts`)

- `received_at` = server clock (never the Date header); `delete_after` =
  received_at + 30 days; `date_header` = parsed Date header as ISO or null.
- Insert is idempotent on `(household_id, message_id)`: a duplicate is
  swallowed (ON CONFLICT DO NOTHING).
- Retention purge: delete rows with `delete_after <= now` in batches of 500
  per table; returns `{messages, quarantine, batches}`.

### Retention job (`src/server/jobs/retention.ts`)

`purgeExpired`, `refreshExpiredInvitations(now)` (all households), then
`recordRetentionRun(nowIso)`; log `retention_completed {scheduledFor,
messagesPurged, quarantinePurged, batches, durationMs}` or
`retention_failed`. Schedule `0 3 * * *` UTC.

### Inbound handler (`src/server/email/handler.ts`)

- `rawSize > 2 MiB` → reject `"Message too large"` (log `email_rejected
  reason=too_large`).
- parse failure → reject `"Message could not be parsed"` (log
  `email_parse_failed`).
- quarantine with unknown household → reject `"Unknown recipient"` (log
  `email_rejected reason=unknown_recipient`).
- unreviewed quarantine count ≥ 200 → reject `"Mailbox quarantine is full"`
  (log `email_rejected reason=quarantine_full`).
- else insert quarantine (log `email_quarantined`) or message (log
  `email_stored {householdId, providerKey, codeFound, truncated}`).
- unexpected error → log `email_ingest_failed`, propagate (temporary failure).

Go mapping: reject → HTTP 406; stored/quarantined → 200 `{ok:true,
outcome:"stored"|"quarantined"}`; unexpected → 500.

### Outbound mail (`src/server/email/sender.ts`)

Two messages, text and HTML bodies verbatim:
- Password reset: subject `Reset your Mi Casa Su Casa password`; text lines
  `Hi <name|there>,` / blank / `We received a request to reset your Mi Casa
  Su Casa password.` / `Use this link to choose a new password: <url>` /
  blank / `If you did not request this, you can safely ignore this email.`
- Invitation: subject `<inviterName> invited you to Mi Casa Su Casa`; text
  `Hi <inviteeName>,` / blank / `<inviterName> (<inviterEmail>) invited you
  to join Mi Casa Su Casa as a <Owner|Member>.` / `Accept the invitation
  here: <url>` / `This invite expires on <expiresAt>.`
HTML versions escape every interpolated value.

## A4. Request schemas (`src/server/http/schemas.ts`)

| Schema | Rules |
|---|---|
| email | trim, lower-case, 3..254, `^[^\s@]+@[^\s@]+\.[^\s@]+$` |
| password | 12..128 (not trimmed) |
| role | `owner|member` (`admin` accepted and mapped to owner) |
| householdSlug | trim, lower-case, slug rules (A3) |
| householdSettings | `{displayName: trimmed 1..80}` |
| createHousehold | `{slug, displayName}` |
| provider | `{providerKey: trim, lower, 1..40, ^[a-z0-9][a-z0-9-]*$, displayName 1..80}` |
| senderRule | `{providerId 1..64, matchType exact|domain, matchValue trim lower 1..254}`; domain: strip leading `@`, must match hostname regex `^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$` else `"matchValue must be a domain like netflix.com"`; exact: must be a valid email else `"matchValue must be a full email address"` |
| invitation | `{email, name 1..80, role default member, providerIds string[] ≤50 default []}` |
| createMember | `{email, name, role default member}` |
| roleChange | `{role}` |
| providerAccess | `{providerKey 1..40 lower}` |
| profile | `{name 1..80, image?: "" or http(s) URL ≤2048}` → image null when empty |
| setup | `{email, name, password, householdName 1..80, householdSlug, setupSecret non-empty}` |
| acceptInvitation | `{name, password}` |
| quarantineReview | `{action dismiss|release, providerKey? 1..40 lower}` |
| messageStatus | `{status new|used|expired}` |

Messages: `"<field> is required"`, `"<field> must be at most N characters"`,
`"password must be at least 12 characters"`, `"role must be owner or member"`,
`"matchType must be exact or domain"`, `"action must be dismiss or release"`,
`"status must be new, used or expired"`, `"email must be a valid email
address"`, `"providerKey may only contain lowercase letters, numbers and
hyphens"`, `"image must be an http(s) URL"`.

## A5. Schema (Postgres translation of `migrations/*.sql`)

All ids are `text` UUIDs generated by the app. Timestamps become
`timestamptz` (TS stored ISO text / epoch ms). JSON details become `jsonb`.

Limen-owned (see B4): `users`, `sessions`, `accounts`, `verifications`,
`rate_limits`, `two_factors`; plus our columns on `users`: `name text NOT
NULL DEFAULT ''`, `image text`, `two_factor_enabled boolean NOT NULL DEFAULT
false`.

App tables:

```
households(id pk, slug text unique, display_name text, created_at, updated_at)
household_memberships(id pk, household_id fk cascade, user_id fk users cascade,
  role text check in (owner, member), created_at, updated_at,
  unique(household_id, user_id), idx household_id, idx user_id)
providers(id pk, household_id fk cascade, provider_key text, display_name text,
  created_at, unique(household_id, provider_key), idx household_id)
household_member_provider_access(id pk, household_membership_id fk cascade,
  provider_id fk cascade, created_at, unique(membership, provider), idx both)
sender_rules(id pk, household_id fk cascade, provider_id fk cascade,
  match_type check in (exact, domain), match_value text, created_at,
  unique(household_id, match_type, match_value), idx(household_id, match_type, match_value))
messages(id pk, message_id text, household_id fk cascade, provider_id fk cascade,
  envelope_from, envelope_to, from_header null, subject null, text_body,
  extracted_code null, status check in (new, used, expired) default new,
  classification_reason, raw_size int, date_header timestamptz null,
  received_at timestamptz, delete_after timestamptz, created_at,
  unique(household_id, message_id), idx(household_id, provider_id, received_at),
  idx(household_id, received_at), idx(delete_after))
quarantine_messages(id pk, message_id, household_id fk cascade, envelope_from,
  envelope_to, from_header, subject, text_body, extracted_code, quarantine_reason,
  raw_size, date_header, received_at, delete_after, reviewed_at null, created_at,
  unique(household_id, message_id), idx(household_id, received_at), idx(delete_after))
audit_events(id pk, actor_user_id null, household_id null, action, target_type,
  target_id null, details jsonb null, created_at, idx(household_id, created_at))
app_installation(id int pk check id=1, status check in (pending, in_progress, complete),
  owner_user_id null, owner_email null, completed_at null, created_at, updated_at,
  last_retention_run_at null)
household_invitations(id pk, household_id fk cascade, email, name, role check,
  token_hash unique, status check in (pending, accepted, cancelled, expired),
  invited_by_user_id fk users cascade, accepted_by_user_id fk users set null,
  expires_at timestamptz, accepted_at, cancelled_at, created_at, updated_at,
  idx household_id, idx email, idx status, idx expires_at)
household_invitation_provider_access(id pk, invitation_id fk cascade,
  provider_id fk cascade, created_at, unique(invitation_id, provider_id))
rate_limit(key text pk, count int default 0, expires_at timestamptz, idx expires_at)
```

`rate_limit` follows Pjokk's shape (key/count/expires_at with a `Hit`
upsert) instead of the TS `last_request` layout; behaviour is the same fixed
window.

## A6. Audit actions

`installation.setup_completed`, `household.created`, `household.settings_updated`,
`member.left`, `member.removed`, `member.role_changed`,
`member.provider_access_granted`, `member.provider_access_revoked`,
`provider.created`, `provider.updated`, `provider.deleted`,
`sender_rule.created`, `sender_rule.updated`, `sender_rule.deleted`,
`invitation.created`, `invitation.resent`, `invitation.cancelled`,
`quarantine.dismiss`, `quarantine.release`, `session.revoked_others`,
`session.revoked`. Audit writes never fail the request (log
`audit_write_failed`).

## A7. Log events (`docs/operations.md`)

One JSON line per event: `{"event", "level", ...fields}` on stdout/stderr.
Events: `api_request_failed`, `unhandled_error`, `env_misconfigured` (boot
only in Go), `email_rejected`, `email_parse_failed`, `email_quarantined`,
`email_stored`, `email_ingest_failed`, `invitation_email_failed`,
`password_reset_email_failed`, `member_left`, `member_removed`,
`setup_recovered_existing_owner`, `setup_orphan_user_removed`,
`setup_failed`, `setup_cleanup_failed`, `invitation_accept_failed`,
`retention_completed`, `retention_failed`, `audit_write_failed`. Never log
message bodies or codes.

## A8. Auth behaviour to preserve

- Password 12..128; sessions 30 days, refreshed at most daily; password reset
  revokes other sessions; sign-up disabled on the public surface.
- Two-factor: TOTP enrolment needs the password; backup codes; verifying a
  TOTP or backup code completes a challenged sign-in; disable needs the
  password.
- Rate limits on auth routes: sign-in 5/min, request reset 3/5 min, reset
  5/5 min, TOTP verify 5/min, backup-code verify 5/min, everything else
  60/min.
- Client IP: never stored raw (Go: keyed digest).

---

# Part B — Limen Integration (source-verified)

Versions in the module cache on this machine (pin these in go.mod):
- `github.com/thecodearcher/limen v0.2.2-0.20260813001613-c6a34aa6dcb4`
- `github.com/thecodearcher/limen/adapters/sql` (same pseudo-version line)
- `github.com/thecodearcher/limen/plugins/credential-password v0.2.1-0.20260813001613-c6a34aa6dcb4`
- `github.com/thecodearcher/limen/plugins/two-factor v0.2.1-0.20260813001613-c6a34aa6dcb4`
- npm `limen-auth` ^0.1.1 (`limen-auth/react`, `limen-auth/plugins`).

If `go get` resolves newer tagged versions, take them and re-verify the
route IDs in B3.

## B1. Construction

```go
sqlDB := stdlib.OpenDBFromPool(pool)
secret := sha256.Sum256([]byte(cfg.AuthSecret))
instance, err := limen.New(&limen.Config{
    BaseURL:  cfg.AppURL,
    Database: sqladapter.NewPostgreSQL(sqlDB),
    Secret:   secret[:],
    Schema: limen.NewDefaultSchemaConfig(
        limen.WithSchemaIDGenerator(uuidGenerator{}),   // text uuids
        limen.WithSchemaUser(limen.WithUserAdditionalFields(func() map[string]limen.ColumnType { ... name, image })),
    ),
    Session: limen.NewDefaultSessionConfig(
        limen.WithSessionDuration(30*24*time.Hour),
        limen.WithSessionUpdateAge(24*time.Hour),
        limen.WithSessionIPAddressExtractor(ipDigest),
    ),
    HTTP: limen.NewDefaultHTTPConfig(
        limen.WithHTTPBasePath("/api/auth"),
        limen.WithHTTPSessionCookieName("mi_casa_session"),
        limen.WithHTTPCookieSecure(strings.HasPrefix(cfg.AppURL, "https://")),
        limen.WithHTTPDisabledPaths(disabledRouteIDs()),
        limen.WithHTTPRateLimiter(
            limen.WithRateLimiterKeyGenerator(ipDigest),
            limen.WithRateLimiterCustomRule("/signin/credential", 5, time.Minute),
            limen.WithRateLimiterCustomRule("/passwords/request-reset", 3, 5*time.Minute),
            limen.WithRateLimiterCustomRule("/passwords/reset", 5, 5*time.Minute),
            limen.WithRateLimiterCustomRule("/two-factor/verify", 5, time.Minute),
        ),
    ),
    Plugins: []limen.Plugin{
        credentialpassword.New(
            credentialpassword.WithPasswordMinLength(12),
            credentialpassword.WithAutoSignInOnSignUp(false),
            credentialpassword.WithSendPasswordResetEmail(func(email, token string) { ... }),
            credentialpassword.WithOnPasswordResetSuccess(func(ctx, user) { revoke all sessions }),
        ),
        twofactor.New(
            twofactor.WithSecret(cfg.AuthSecret),
            twofactor.WithTOTP(twofactor.WithTOTPIssuer(cfg.AppName)),
            twofactor.WithOTP(twofactor.WithOTPEnabled(false)),
            twofactor.WithBackupCodes(twofactor.WithBackupCodesCount(10)),
            twofactor.WithRevokeOtherSessionsOnStateChange(true),
        ),
        core, // our plugin capturing *limen.LimenCore (as Pjokk's core_plugin.go)
    },
})
mux.Handle("/api/auth/", instance.Handler())
```

Exact option names in the two-factor and credential packages are listed in
the module cache (`config.go` in each); the `sha256` of `AUTH_SECRET` is
Limen's 32-byte requirement. `WithSchemaUser`/`WithUserAdditionalFields`
signatures must be checked against `schema_config.go` when wiring (Pjokk's
`auth.go` compiles against the same version and is the working example).

## B2. Server-side APIs

- `instance.GetSession(r) (*limen.ValidatedSession, error)` →
  `{User *limen.User, Session *limen.Session, Refreshed *SessionResult}`.
  `User.ID any` (string with our generator), `User.Email`, `User.Raw()` for
  `name`, `image`, `two_factor_enabled`.
- `instance.RevokeSession(ctx, token)`, `RevokeAllSessions(ctx, userID)`,
  `ListSessions(ctx, userID) ([]limen.Session, error)`.
- Credential plugin (`credentialpassword.Use(instance)`):
  `SignUpWithCredentialAndPassword(ctx, &limen.User{Email, Password:&pw}, map[string]any{"name": name})`
  (returns `*AuthenticationResult` with `.User`), `RequestPasswordReset(ctx,
  email)`, `ResetPassword(ctx, token, newPassword)`, `UpdatePassword(ctx,
  user, current, new, revokeOthers)`.
- Core (from our capturing plugin): `core.CreateSession(ctx, r, w,
  &limen.AuthenticationResult{User: u})` sets the session cookie on `w` —
  used by `/api/setup/complete` and `/api/invitations/accept` to sign the new
  user in. `core.DBAction.FindUserByEmail(ctx, email)` /
  `FindUserByID(ctx, id)`; `limen.ErrRecordNotFound` when absent.
- Two-factor plugin (`twofactor.Use(instance)`): `FindTwoFactorByUserID`,
  `InitiateTwoFactorSetup(ctx, *UserWithTwoFactor, password)`,
  `FinalizeTwoFactorSetup`, `DisableTwoFactor(ctx, userID, password)`.
  HTTP handles the SPA's needs; the Go API is only for tests.
- User deletion: no Limen API — `DELETE FROM users WHERE id = $1` (cascades).

## B3. HTTP routes (IDs for `WithHTTPDisabledPaths`)

Core: `GET /me` (`me`), `GET /sessions` (`list-sessions`), `POST /signout`
(`signout`), `POST /revoke-sessions` (`revoke-sessions`), `verify-email`,
`email-verifications`.
Credential: `POST /signin/credential` (`signin`, body `{credential,
password, rememberMe?}`), `POST /signup/credential` (`signup`), `POST
/passwords/request-reset` (`passwords-request-reset`, `{email}`), `POST
/passwords/reset` (`passwords-reset`, `{token, newPassword}`), `POST
/passwords/change` (`passwords-change`, `{currentPassword, newPassword,
revokeOtherSessions}`), `PUT /passwords` (`passwords-set`), `POST
/usernames/check` (`usernames-check`).
Two-factor (base `/two-factor`): `POST /initiate-setup` (`{password}` →
`{uri}` otpauth URI), `POST /finalize-setup` (`{code}`), `POST /disable`
(`{password}`), `POST /verify` (`{code, method?: "totp"|"otp"}`; a backup
code is passed as `code` with method `totp` — the plugin detects the
backup-code shape), `GET /totp/uri`, `GET /backup-codes`, `PUT
/backup-codes` (regenerate), `POST /otp/send` (disabled).

Sign-in with 2FA enabled: the plugin's after-hook on `signin` revokes the
issued session, sets a challenge cookie and answers `200
{"two_factor_required": true}`; the client then calls `/two-factor/verify`.

**Allowed** in Mi Casa: `signin`, `signout`, `me`, `list-sessions`,
`revoke-sessions`, `passwords-request-reset`, `passwords-reset`,
`passwords-change`, and every two-factor route except `otp-send`.
**Disabled**: `signup`, `passwords-set`, `usernames-check`, `verify-email`,
`email-verifications`, `otp-send`.

## B4. Schema

Limen does not auto-migrate. Tables (Postgres DDL as in Pjokk's
`00001_init.sql`, minus organizations):

```sql
CREATE TABLE "users" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "public_id" text NOT NULL DEFAULT gen_random_uuid()::text,
  "first_name" text, "last_name" text,
  "email" text NOT NULL, "password" text, "email_verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "name" text NOT NULL DEFAULT '', "image" text,
  "two_factor_enabled" boolean NOT NULL DEFAULT false,
  CONSTRAINT "users_email_unique" UNIQUE ("email"),
  CONSTRAINT "users_public_id_unique" UNIQUE ("public_id"));
CREATE TABLE "sessions" (id, user_id fk cascade, token unique, created_at, expires_at, last_access, metadata text);
CREATE TABLE "accounts" (id, user_id fk cascade, provider, provider_account_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, created_at, updated_at, unique(provider, provider_account_id));
CREATE TABLE "verifications" (id, identifier, value, expires_at, created_at, updated_at; idx identifier);
CREATE TABLE "rate_limits" (id, key unique, count int default 0, expires_at);
CREATE TABLE "two_factors" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "secret" text NOT NULL, "backup_codes" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "two_factors_user_unique" UNIQUE ("user_id"));
```

Session metadata is a JSON string holding `ip_address` (our digest) and
`user_agent`; `/api/settings` reads them from there.

## B5. TS client (`limen-auth`)

```ts
import { createAuthClient } from "limen-auth/react";
import { credentialPasswordPlugin, twoFactorPlugin } from "limen-auth/plugins";

export const authClient = createAuthClient({
  baseURL: "",            // same origin
  basePath: "/api/auth",
  plugins: [
    credentialPasswordPlugin(),
    twoFactorPlugin({ onTwoFactorRedirect: () => {} }), // LoginPage routes itself
  ],
});
// authClient.useSession()                          → { data: {user}, isPending, refetch }
// authClient.signIn.credential({credential, password})
// authClient.signout()
// authClient.password.requestReset({email}); authClient.password.reset({token, newPassword});
// authClient.password.change({currentPassword, newPassword})
// authClient.twoFactor.initiateSetup({password}) → {uri}
// authClient.twoFactor.finalizeSetup({code}); authClient.twoFactor.disable({password})
// authClient.twoFactor.verify({code, method:"totp"})
// authClient.twoFactor.getBackupCodes(); authClient.twoFactor.regenerateBackupCodes()
```

Exact method names come from each plugin's `RouteDescriptor.as` (listed in
`node_modules/limen-auth/dist/plugins/*/index.d.mts`); confirm at install
time. The session payload has **no** `user.id` — Limen exposes `public_id`.
Screens that need the row id read it from `GET /api/settings` (`profile.id`).

Mapping from today's Better Auth calls:

| Better Auth | Limen client |
|---|---|
| `signIn.email({email,password})` | `signIn.credential({credential: email, password})`; response `two_factor_required` → navigate to `/two-factor` |
| `signOut()` | `signout()` |
| `requestPasswordReset({email, redirectTo})` | `password.requestReset({email})` (link built server-side) |
| `resetPassword({newPassword, token})` | `password.reset({token, newPassword})` |
| `changePassword({currentPassword,newPassword,revokeOtherSessions})` | `password.change({...})` |
| `twoFactor.enable({password})` → totpURI + backupCodes | `twoFactor.initiateSetup({password})` → `{uri}`, then `twoFactor.getBackupCodes()` after `finalizeSetup` |
| `twoFactor.verifyTotp({code})` (enrolment) | `twoFactor.finalizeSetup({code})` |
| `twoFactor.verifyTotp({code})` / `verifyBackupCode({code})` (sign-in) | `twoFactor.verify({code, method:"totp"})` |
| `twoFactor.disable({password})` | `twoFactor.disable({password})` |
| `passkey.*` | removed |

## B6. Known risks

1. Both plugins are pseudo-versions; pin exactly and cover every used route
   in `testrig` HTTP tests.
2. Always set `WithHTTPBasePath("/api/auth")`; Limen matches full paths.
3. Only `internal/auth` imports Limen packages.
4. `WithSendPasswordResetEmail` receives `(email, token)` only; the reset URL
   is `APP_URL/reset-password?token=<token>` and the user's name for the
   greeting is looked up by email.

---

# Part C — Mailgun inbound contract (verified 2026-09-04)

- Route: `match_recipient(".*@<EMAIL_DOMAIN>")` → `forward("https://<APP_URL>/api/inbound/mailgun/mime")`.
  A URL ending in `mime` makes Mailgun post the raw message in the
  `body-mime` field instead of the parsed `body-plain`/`body-html`.
- POST is `multipart/form-data` with at least: `recipient`, `sender`
  (envelope MAIL FROM), `from` (From header), `subject`, `body-mime`,
  `timestamp`, `token`, `signature`, `message-headers` (JSON array), and
  attachments (ignored).
- Signature: `signature == hex(HMAC-SHA256(key = HTTP webhook signing key,
  data = timestamp + token))`. Reject when the timestamp is older than 5
  minutes or the token was seen within the last 10 minutes.
- Authentication headers on the stored message: `X-Mailgun-Spf` (Pass,
  Neutral, Fail, SoftFail) and `X-Mailgun-Dkim-Check-Result` (Pass, Fail);
  only present when Mailgun evaluated them. Lower-case them into
  `authentication.spf` / `.dkim`; `dmarc` stays null unless an
  `Authentication-Results` header supplies one.
- Retry semantics: Mailgun retries non-2xx responses for up to 8 hours,
  **except 406 Not Acceptable**, which it treats as a permanent rejection.
- Test with a recorded fixture: a multipart body with the fields above and a
  signature computed with a known key; Go's handler tests build the same
  form with `mime/multipart`.
