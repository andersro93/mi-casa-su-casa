# Inbound mail

Mi Casa Su Casa receives household mail through a **Mailgun route**: Mailgun
holds the MX records for your inbox domain, and every message it accepts is
forwarded to the app as a signed `multipart/form-data` POST. There is no SMTP
listener in the image, and nothing to open a port for beyond the HTTP one the
app already serves.

This guide covers the Mailgun side (receiving domain, DNS, route, signing
key), what the app does with a message once it arrives, how to test the
endpoint by hand, and what the failure modes look like.

See also: [`operations.md`](./operations.md) for the log events named here,
[`runbook.md`](./runbook.md) for "mail stopped arriving", and the README's
[Self-hosting](../README.md#self-hosting) section for the environment
variables.

## Prerequisites

- A Mailgun account (any plan that includes routes — the free tier does).
- A domain, or a subdomain, whose MX records you can point at Mailgun. This
  becomes `EMAIL_DOMAIN`.
- The app deployed and reachable over HTTPS at `APP_URL`. Mailgun posts to it
  from the public internet; a route pointing at something unreachable simply
  retries for eight hours and gives up.

**Use a dedicated subdomain** (`casa.example.com`) unless the apex has no mail
at all. MX records are per hostname and cannot be split between two providers:
pointing `example.com` at Mailgun takes *all* of its mail with it.

## Setting it up

### 1. Add the receiving domain

In Mailgun, add `EMAIL_DOMAIN` as a domain and publish the DNS records it
lists. For receiving, the ones that matter are:

| Type | Host | Value | Priority |
| --- | --- | --- | --- |
| MX | `casa.example.com` | `mxa.mailgun.org` | 10 |
| MX | `casa.example.com` | `mxb.mailgun.org` | 10 |
| TXT | `casa.example.com` | the SPF value Mailgun shows (`v=spf1 include:mailgun.org ~all`) | — |
| TXT | `<selector>._domainkey.casa.example.com` | the DKIM public key Mailgun generates | — |

The SPF and DKIM records are strictly about *sending*, but publish them
anyway: Mailgun stamps `X-Mailgun-Spf` and `X-Mailgun-Dkim-Check-Result` on
inbound mail based on its own evaluation of the *sender's* domain, and the
records here are what let this domain send its own invitation and reset mail
through the same account (see [Sending mail](../README.md#sending-mail)).

Wait for Mailgun to verify the domain before continuing. An unverified domain
accepts no mail.

### 2. Create the route

Mailgun → *Receiving → Routes → Create route*. One route covers every
household on the domain, because the app resolves the household from the
recipient's local part itself:

| Field | Value |
| --- | --- |
| Expression | `match_recipient(".*@casa.example.com")` |
| Action | `forward("https://casa.example.com/api/inbound/mailgun/mime")` |
| Priority | anything; `0` if this is the only route |

Two details are load-bearing:

- **The URL must end in `mime`.** Mailgun decides what to post from the shape
  of the forwarding URL: a URL ending in `mime` sends the raw RFC 5322 message
  in a `body-mime` field, and anything else sends Mailgun's own parsed
  `body-plain` / `body-html`. The app reads `body-mime` and nothing else, so a
  route without the suffix delivers messages the app answers **406** to.
- **`match_recipient` takes a regex**, so the dot in the domain is a
  metacharacter. `.*@casa.example.com` is what Mailgun's own documentation
  shows and works fine; `.*@casa\.example\.com` is stricter and equally
  correct.

You do not need one route per household. Mail to a local part that matches no
household is rejected with a 406 and a `email_rejected`
(`reason: unknown_recipient`) log line — deliberately, so the sender is told
rather than left believing it was delivered.

### 3. Set the signing key

Mailgun → *Sending → Webhooks* → **HTTP webhook signing key**. This is **not**
the API key, and using the API key here produces a 401 on every message with
nothing in Mailgun's UI to explain it.

Set it as `MAILGUN_WEBHOOK_SIGNING_KEY` and restart the app.

Every forwarded POST carries three extra fields — `timestamp` (unix seconds),
`token` (a random string) and `signature` — and the app checks all three:

- `signature` must equal `hex(HMAC-SHA256(key, timestamp + token))`, compared
  in constant time;
- `timestamp` must be within **5 minutes** of now, in either direction (a
  timestamp far in the future is as good a sign of forgery as an ancient one);
- `token` must not have been seen in the last **10 minutes**.

The replay guard is in memory, so it is per process and forgotten on restart.
That is deliberate: the timestamp window is the half of the defence that
always holds, and a replay that slipped through would produce one duplicate
message, which the `(household, message-id)` uniqueness swallows anyway.

### 4. Send a test message

Send an ordinary email from any address to `<household-slug>@casa.example.com`
— the slug is the one chosen during `/setup`, visible in the app under
household settings, which also shows the full address to copy.

Then look at one of three places:

- **Latest codes** — the sender matched a configured rule and passed
  authentication.
- **Needs review** — it did not. Release it from there and add a sender rule
  for that address or domain, and the next one lands in the inbox.
- **Mailgun → Logs** — nothing arrived at all. The log line shows the HTTP
  status the app answered with; see [Troubleshooting](#troubleshooting).

## What the app does with a message

```
Mailgun route
   │  POST /api/inbound/mailgun/mime   (multipart/form-data)
   ▼
signature + timestamp + replay guard ──────── fail ──▶ 401 (inbound_rejected)
   │
   ▼
size check (body-mime ≤ 2 MiB) ───────────── too big ──▶ 406 (email_rejected)
   │
   ▼
MIME parse (headers, text body, verdicts) ── fail ────▶ 406 (email_parse_failed)
   │
   ▼
classify
   ├── no household for this recipient ─────────────── ▶ 406 (email_rejected)
   ├── no sender rule matched ──────────────────┐
   ├── rule matched, authentication failed ─────┤
   │                                            ▼
   │                                    quarantine_messages ─▶ 200 (email_quarantined)
   └── rule matched and authenticated ─▶ messages ────────────▶ 200 (email_stored)
```

**Parsing.** The raw message is parsed into an envelope sender and recipient,
the `From` header address, `Message-ID` (or a deterministic synthetic one),
date, subject and a text body. HTML-only messages are stripped to text; the
body is cut at 64 KiB with a marker, and the row records that it was
truncated. Attachments are ignored.

**Authentication verdicts** come from the headers Mailgun stamps on the
message: `X-Mailgun-Spf` (`Pass`, `Neutral`, `Fail`, `SoftFail`) and
`X-Mailgun-Dkim-Check-Result` (`Pass`, `Fail`), lower-cased. A DMARC verdict
is only recorded if an `Authentication-Results` header supplies one.

**Classification** happens in order:

1. Extract a one-time code from the text body — always, so a quarantined
   message still shows one on the review screen.
2. Resolve the household from the recipient's local part (`casa@…` →
   household `casa`; uppercase is lower-cased first). No slug, or a slug this
   installation does not have, is a rejection.
3. Match the sender against the household's `sender_rules`. The `From` header
   address is tried before the envelope sender, because the header is the one
   a person sees and pins a rule to. No match is a quarantine, with the reason
   *"No sender rule matched the inbound email within the addressed
   household."*
4. Judge the match against the verdicts. The rule is asymmetric on purpose —
   SPF authenticates the *envelope* sender and says nothing about the `From`
   header:

   | Rule matched on | Needs |
   | --- | --- |
   | the `From` header | `dkim=pass` **or** `dmarc=pass` |
   | the envelope sender | `spf=pass` |

   An explicit `dmarc=fail` is the domain owner's own verdict and overrules
   both. A message with no `Authentication-Results` and no Mailgun verdicts at
   all is trusted, because the rule has already matched and quarantining every
   message from an MTA that does not annotate would be worse than useless.

   A rule that matched but failed this step is quarantined with a reason that
   names both, e.g. *"Sender billing@netflix.com matched provider netflix but
   sender authentication failed: From header not authenticated (dkim=none,
   dmarc=none)."*

5. Store it — in `messages` with the extracted code, or in
   `quarantine_messages` with the reason.

**Quarantine is bounded.** A household may hold **200** unreviewed quarantine
rows; past that, further unmatched mail is refused with a 406 and
`reason: quarantine_full`. Review the queue and it drains.

## Response codes

The status code is the whole conversation with Mailgun, because Mailgun's
retry policy reads it:

| Status | Meaning | Mailgun's reaction |
| --- | --- | --- |
| `200` | Stored or quarantined | Done |
| `401` | Not authenticated: bad signature, stale timestamp, replayed token, or a body that would not parse as a form | Retries for up to 8 hours — and will keep failing until the key or the clock is fixed |
| `404` | A path under `/api/inbound/` that is not the webhook (a typo in the route URL) | Retries |
| `405` | Anything but `POST` | Retries |
| `406` | **Permanent** rejection: too large, unparseable, unknown recipient, quarantine full | Does not retry — which is the point |
| `500` | Something broke on our side (usually the database) | Retries, which is what we want: a database that was down for a minute should not cost a verification code |

A 401 is deliberately vague. Whether the signature, the clock or the replay
guard refused the request goes to the log and never to the caller, so a prober
cannot use the response to tell a wrong key from a wrong clock.

## Testing the endpoint by hand

Everything the endpoint checks can be reproduced with `openssl` and `curl`.
Compute the signature the same way the app does — HMAC-SHA256 over
`timestamp + token`, keyed with the signing key, hex-encoded:

```sh
KEY='your-http-webhook-signing-key'
TS=$(date +%s)
TOKEN=$(openssl rand -hex 16)
SIG=$(printf '%s%s' "$TS" "$TOKEN" \
  | openssl dgst -sha256 -hmac "$KEY" -r \
  | cut -d' ' -f1)
```

Write a minimal message, and post it:

```sh
cat > /tmp/message.eml <<'EOF'
From: Netflix <info@account.netflix.com>
To: casa@casa.example.com
Subject: Your verification code
Message-ID: <test-1@example.com>
Date: Fri, 04 Sep 2026 12:00:00 +0000
X-Mailgun-Spf: Pass
X-Mailgun-Dkim-Check-Result: Pass
Content-Type: text/plain; charset=utf-8

Your verification code is 123456
EOF

curl -i -X POST https://casa.example.com/api/inbound/mailgun/mime \
  -F timestamp="$TS" \
  -F token="$TOKEN" \
  -F signature="$SIG" \
  -F recipient='casa@casa.example.com' \
  -F sender='bounce@account.netflix.com' \
  -F 'body-mime=</tmp/message.eml'
```

The `<` in the last `-F` is not a shell redirect — it is curl's syntax for
"read this field's **value** from that file". `-F 'body-mime=@/tmp/message.eml'`
(with an `@`) uploads it as a *file part* with a filename instead, which the
app does not read: you would get a 406 *"Message could not be parsed"*.

Expected answers:

```
200 {"ok":true,"outcome":"stored"}        # sender rule matched and authenticated
200 {"ok":true,"outcome":"quarantined"}   # no rule, or the verdict did not back the match
401 {"error":"Unauthorized"}              # signature, clock or replay
406 {"error":"Unknown recipient"}         # the local part names no household here
```

Two things to know while iterating:

- **Each token works once.** Reusing `$TOKEN` inside ten minutes answers 401.
  Mint a new one per request.
- **A stale `$TS` answers 401 too.** Recompute both if you leave the shell
  sitting for a few minutes.

Against a laptop, point the URL at `http://localhost:3000` and use the
`MAILGUN_WEBHOOK_SIGNING_KEY` from your dev environment. The recipient's local
part must be a household that exists in that database.

## Troubleshooting

### Nothing arrives at all

1. **Mailgun → Logs.** If there is no line for the message, Mailgun never
   received it: check the MX records with `dig MX casa.example.com +short` —
   they must be `mxa.mailgun.org` and `mxb.mailgun.org` — and confirm the
   domain is verified.
2. If there *is* a line, it shows the HTTP status the app answered with.
   Anything but 200 is diagnosed below.
3. **Check the route URL** for the `mime` suffix and the right host. A route
   forwarding to a stale hostname retries silently for eight hours.

### Every message answers 401

The signature check is failing, and the app will not say which of the three
guards refused it. The log will:

```sh
docker compose -f docker-compose.selfhost.yml logs app \
  | grep inbound_rejected
```

`{"event":"inbound_rejected","level":"warn","reason":"…","path":"…"}` — and
the reason is one of:

| Reason | What it means |
| --- | --- |
| `signature` | `MAILGUN_WEBHOOK_SIGNING_KEY` does not match the key Mailgun signs with. The most common cause is using the **API key** instead of the *HTTP webhook signing key* |
| `stale` | The `timestamp` was more than 5 minutes off. The container's clock has drifted, or the message sat in a retry queue longer than the window — a burst of these after an outage is expected and harmless |
| `replay` | The same `token` arrived twice inside 10 minutes. Normal after a Mailgun retry of a message that actually succeeded |
| `malformed` | The request body was not readable as a multipart form. Something other than Mailgun is posting to the endpoint |

Rotating the key: set the new value, restart, and expect a short burst of
`signature` rejections for messages Mailgun signed with the old one and is
still retrying.

### Messages answer 406

Look for `email_rejected` or `email_parse_failed` in the log; the `reason`
field says which:

| Reason | Fix |
| --- | --- |
| `unknown_recipient` | The local part is not a household slug in this installation. Check the address in household settings — and remember the local part must equal the slug exactly |
| `too_large` | The message exceeded 2 MiB of raw MIME. Verification mail is tiny; this is usually a newsletter or something with a large attachment, and refusing it is correct |
| `quarantine_full` | 200 unreviewed rows in this household's quarantine. Work through **Needs review**; the next message is accepted |
| *(`email_parse_failed`)* | The message was not parseable as MIME, or the route is missing its `mime` suffix so no `body-mime` field was sent |

### Messages arrive but land in Needs review

That is the system working. The sender matched no rule, or matched one whose
authentication verdict did not back it up — the quarantine row carries the
reason, and the review screen shows it.

Release the message and add a sender rule for the address or its domain. A
domain rule covers subdomains, so a rule on `netflix.com` also matches
`info@account.netflix.com`.

If it keeps happening for a sender you *have* configured, the verdict is the
problem: check the reason text on the row. `dkim=none, dmarc=none` on a
`From`-header rule usually means the sending domain does not sign its mail;
pin the rule to the envelope sender instead, where SPF applies.

### A message arrives but shows no code

The extractor is keyword-anchored, so an unusual phrasing can slip past it.
The message is stored either way — only the code is missing, and the body is
right there on the screen. The patterns live in
`apps/server/internal/domain/extract.go`; a new one belongs there with a test
fixture beside the existing ones.

## References

- [Mailgun — Receiving, forwarding and storing messages](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/)
- [Mailgun — Routes](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/#routes)
- [Mailgun — Securing webhooks](https://documentation.mailgun.com/docs/mailgun/user-manual/events-tracking/#securing-webhooks)
- [Mailgun — DNS records](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/)
