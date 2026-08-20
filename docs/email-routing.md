# Email routing

Mi Casa Su Casa receives email through [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/). When a message arrives at your shared inbox address, Cloudflare forwards it to the Worker's `email()` handler, which parses, classifies, and stores it in D1.

This guide explains how to configure Email Routing so inbound messages reach the Worker.

## Prerequisites

- A domain managed by Cloudflare (nameservers must point to Cloudflare)
- The Worker deployed at least once (Email Routing needs a Worker target to exist)
- Email Routing enabled on the zone (covered in step 1 below)

## How email flows through the system

```
sender → Cloudflare Email Routing → Worker email() handler
                                        ↓
                                   parseIncomingEmail (PostalMime)
                                        ↓
                                   classifyEmail (sender rule match?)
                                    ↙          ↘
                              matched           unmatched
                                ↓                   ↓
                         extractVerificationCode   insertQuarantineMessage
                                ↓
                         insertMessage
```

1. An external service (e.g. Netflix, Google) sends a verification email to your shared address.
2. Cloudflare Email Routing matches the recipient and forwards the raw RFC 5322 message to the Worker.
3. The Worker parses headers and body using PostalMime.
4. The sender address is checked against `sender_rules` in D1.
   - **Match**: the message is stored in `messages` with any extracted verification code.
   - **No match**: the message is quarantined in `quarantine_messages` for the owner to review.
5. Quarantined messages can be dismissed or released through the app's owner-only quarantine view.

## Setup steps

### 1. Enable Email Routing on your domain

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com) and select your domain.
2. Go to **Email → Email Routing → Overview**.
3. If Email Routing is not yet enabled, click **Get started** and follow the wizard.
4. Cloudflare will add the required MX and TXT (SPF) DNS records automatically. Accept the proposed changes.

> **Note**: Enabling Email Routing changes your domain's MX records. If you already use another email provider (e.g. Google Workspace, Microsoft 365) for this domain, see [Using Email Routing alongside another provider](#using-email-routing-alongside-another-provider) below.

### 2. Create a routing rule

1. Still on **Email → Email Routing**, go to the **Routing rules** tab.
2. Click **Create address**.
3. Set the **Custom address** to the local part you want to use (e.g. `codes`). This creates the address `codes@yourdomain.com`.
4. Under **Action**, select **Send to a Worker**.
5. Choose your deployed Worker from the dropdown:
   - Production: `mi-casa-su-casa`
   - Preview: `mi-casa-su-casa-preview` (if you want preview to receive email too)
6. Click **Save**.

### 3. Verify DNS records

After creating the routing rule, confirm the required DNS records are in place:

1. Go to **DNS → Records** for your domain.
2. You should see:
   - **MX** records pointing to Cloudflare's email routing servers (e.g. `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net`)
   - A **TXT** record for SPF that includes `include:_spf.mx.cloudflare.net`

These records are managed by Cloudflare and were added when you enabled Email Routing. Do not delete them.

### 4. Send a test email

1. Send an email from an external address to your configured address (e.g. `codes@yourdomain.com`).
2. Check your application:
   - If the sender matches a `sender_rules` entry, the message appears in the inbox.
   - If not, it appears in the quarantine view (owner-only).
3. If nothing appears, see [Troubleshooting](#troubleshooting) below.

## Using Email Routing alongside another provider

If your domain already uses another email provider (Google Workspace, Microsoft 365, Fastmail, etc.), you need to be careful with MX records.

**Option A — Dedicated subdomain** (recommended):

Use a subdomain like `home.yourdomain.com` for Email Routing and keep the root domain with your existing provider. This avoids any MX conflicts.

1. Add the subdomain to Cloudflare if it is not already there.
2. Enable Email Routing on the subdomain.
3. Your shared address becomes `codes@home.yourdomain.com`.

**Option B — Catch-all on root domain**:

Cloudflare Email Routing can coexist with another provider if you:

1. Configure Email Routing only for specific addresses (not catch-all).
2. Set a **fallback address** under **Email → Email Routing → Settings** that forwards unmatched mail to your primary provider.

> **Warning**: Enabling Email Routing changes MX records to point to Cloudflare. All mail for the domain flows through Cloudflare first. Make sure the fallback address is configured correctly or you may lose mail intended for your primary provider.

## Sending email (invitations and password resets)

The Worker sends invitation and password-reset emails through the `send_email` binding (`EMAIL` in `wrangler.jsonc`). For that to work:

1. Set `OUTBOUND_EMAIL_FROM` on the Worker (Cloudflare dashboard → Settings → Variables) to an address on a domain where Email Routing is enabled, e.g. `noreply@home.yourdomain.com`. Cloudflare only allows sending from addresses on your Email Routing domains.
2. While the destination domain is not yet verified for sending, Cloudflare may reject sends to arbitrary addresses; add verified destination addresses under **Email → Email Routing → Destination addresses** if you hit rejections.

If an invitation email cannot be delivered, the API still creates the invitation and returns `emailSent: false` together with the `inviteUrl`; the app shows a **Copy invite link** action so the owner can share it directly. Delivery failures are logged as `{"event":"invitation_email_failed", ...}` in Workers Logs.

## Local development

Email routing is a Cloudflare infrastructure feature and does not run locally. To test the email pipeline during development, post a raw RFC 5322 message to the Wrangler dev endpoint:

```bash
curl -X POST 'http://localhost:8787/cdn-cgi/handler/email?from=sender@example.com&to=codes@example.com' \
  --data-raw $'From: sender@example.com\nTo: codes@example.com\nSubject: Your verification code\nMessage-ID: <test-1@dev>\n\nYour verification code is 123456'
```

`/cdn-cgi/handler/email` is a Cloudflare/Wrangler development endpoint that forwards a request to the Worker `email()` handler locally. It is not a normal application API route. See the [README](../README.md#test-email-ingestion-locally) for more examples.

## Troubleshooting

### Email is not arriving at the Worker

1. **Check the routing rule**: Go to **Email → Email Routing → Routing rules** and confirm the address exists and targets the correct Worker.
2. **Check DNS records**: Verify MX records point to Cloudflare's email routing servers. If they point elsewhere, Email Routing cannot receive mail.
3. **Check Worker deployment**: The Worker must be deployed before Cloudflare can route email to it. Run `wrangler deploy` or push to `main` to trigger a production deploy.
4. **Check Worker logs**: In the Cloudflare dashboard, go to **Workers & Pages → your Worker → Logs** and look for `email()` handler invocations or errors.

### Email arrives but is quarantined unexpectedly

The sender address did not match any row in the `sender_rules` table. This is expected behavior for unrecognized senders.

To fix:
1. Open the app as the owner.
2. Go to the quarantine view.
3. Review the message — if it is legitimate, release it and add a sender rule for that address or domain.

### Email arrives but no verification code is extracted

The code extraction logic uses keyword-anchored regex patterns. If a service uses an unusual format, the code may not be detected. The message is still stored — only the `verification_code` field will be null.

To improve extraction for a specific service, check the patterns in `src/server/domain/extract-code.ts`.

## References

- [Cloudflare Email Routing overview](https://developers.cloudflare.com/email-routing/)
- [Cloudflare Email Routing — Enable Email Routing](https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/)
- [Cloudflare Email Routing — Routing rules](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/)
- [Cloudflare Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [Cloudflare Email Routing DNS records](https://developers.cloudflare.com/email-routing/troubleshooting/missing-dns-records/)
