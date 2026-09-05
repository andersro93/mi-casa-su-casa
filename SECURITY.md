# Security policy

Mi Casa Su Casa stores the text of real emails and the one-time verification
codes extracted from them. A code sitting in the database is a code somebody
can still use for as long as the sending service honours it, and a household's
inbox is a household's inbox. Security reports are taken seriously and handled
with priority.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub:

**[Security → Report a vulnerability](https://github.com/andersro93/mi-casa-su-casa/security/advisories/new)**

Do not open a public issue for security problems, and please test against your
own deployment or the compose stack in this repository rather than against
somebody else's instance.

What to include: affected version or commit, reproduction steps, and impact as
you understand it. You can expect an acknowledgement within a few days — this
is a small project, not a security team — and credit in the release notes for
a confirmed report, if you want it.

## Scope

- The application: the Go server, the SPA, the container image and its release
  artifacts.
- The inbound mail path in particular: webhook signature verification, the
  replay guard, sender-rule matching and the SPF/DKIM verdict rules that
  decide whether a matched sender is trusted. Getting a message into a
  household's inbox that should have been quarantined — or into a household it
  was not addressed to — is the highest-impact bug class here.
- Tenant isolation: any way for a member of one household to read another's
  mail, or for a member to see a service the owner did not grant them.
- Auth: session handling, the first-run `/setup` guards, invitation tokens,
  two-factor enrolment and verification, password reset.
- The CI/release pipeline: workflow injection, artifact tampering.

Out of scope: vulnerabilities in third-party dependencies without a
demonstrated impact here (report those upstream — but a heads-up is welcome),
and anything that requires an operator to have already misconfigured the
deployment in a way the README warns against (`TRUSTED_PROXY_HOPS` set too
high, `ENVIRONMENT=development` on a public host, a `?starttls=off` relay).

## What the application deliberately does not do

Knowing these saves a report:

- **It is not a password vault.** It stores no service account passwords, and
  it never has.
- **Message bodies are rendered as plain text**, never as HTML.
- **Logs never contain message bodies, verification codes, invitation tokens
  or query strings.** If you find one that does, that is a report worth
  making.
- **Client addresses are stored as keyed digests**, never raw.
- **Sign-up is closed.** Accounts exist only through first-run `/setup` and
  invitation acceptance.
- **Passkeys are not supported.** Sign-in is email and password, with optional
  TOTP two-factor and backup codes.
- The inbound webhook is **not** rate-limited: it is authenticated by
  signature, the request size is bounded, and the timestamp window plus the
  replay guard bound what a captured request can do.

## Verifying releases

Release artifacts and container images are signed with keyless
[cosign](https://github.com/sigstore/cosign) through GitHub's OIDC, and ship
SPDX SBOMs — see the
["Verifying a release"](./README.md#verifying-a-release) section of the
README. An unsigned image claiming to be a release is not one.
