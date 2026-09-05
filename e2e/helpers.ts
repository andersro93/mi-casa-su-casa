import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  type APIRequestContext,
  type APIResponse,
  request as apiRequest,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  expect,
  type Page,
} from "@playwright/test";
import { TOTP, URI } from "otpauth";

// Everything the specs share: the constants the e2e stack is started with
// (scripts/e2e-stack.sh), the API shortcuts fixtures use instead of driving a
// screen that is not under test, and the three seams no unit test can reach —
// Mailpit, the signed Mailgun webhook, and a real TOTP.

/** Where the app is. Must match the stack's APP_URL: it is the origin the
 * same-site guard compares against and the base of every mailed link. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3300";

/** Mailpit's HTTP API (the container publishes 8025 here). */
export const MAILPIT_URL =
  process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8325";

/** scripts/e2e-stack.sh's SETUP_SECRET / OWNER_EMAIL / EMAIL_DOMAIN. */
export const SETUP_SECRET = "e2e-setup-secret";
export const OWNER_EMAIL = "owner@e2e.test";
export const EMAIL_DOMAIN = "e2e.test";
/** scripts/e2e-stack.sh's MAILGUN_WEBHOOK_SIGNING_KEY. */
export const MAILGUN_SIGNING_KEY = "e2e-signing-key";

/** The household global-setup.ts creates. Its slug is also its mailbox. */
export const OWNER_SLUG = "e2e-home";
export const OWNER_HOUSEHOLD = "E2E Household";
export const OWNER_NAME = "Ola Owner";

/**
 * One password for every synthetic account. The server's floor is 12
 * characters (setup, invitation acceptance and reset all say so), and the SPA
 * refuses to submit anything shorter, so this is deliberately over it.
 */
export const PASSWORD = "e2e-password-12345";

/**
 * Where saved sessions live. Relative on purpose: the suite is always run from
 * `e2e/` (the mise task and the CI job both cd here, and Playwright resolves a
 * config's own relative paths the same way), so one spelling serves
 * `context.storageState({ path })` and `test.use({ storageState })` alike.
 */
const STATE_DIR = ".auth";

/** Where global-setup.ts leaves the owner's signed-in state. */
export const OWNER_STATE = `${STATE_DIR}/owner.json`;

let counter = 0;

/** A unique address per call so specs never collide on accounts or mailboxes. */
export function freshEmail(tag: string): string {
  counter += 1;
  return `${tag}-${Date.now().toString(36)}-${counter}@${EMAIL_DOMAIN}`;
}

/** A unique service key per call: two projects run inbox.spec.ts against one
 * database, and a provider key is unique per household. */
export function freshKey(tag: string): string {
  counter += 1;
  return `${tag}-${Date.now().toString(36)}-${counter}`;
}

/**
 * A distinct client address for one browser context or API client.
 *
 * The stack runs with TRUSTED_PROXY_HOPS=1 and the suite plays the reverse
 * proxy, so this header is what the app takes as the caller's address. Every
 * per-client rate limit — sign-in 5/min, the session endpoint 60/min,
 * invitations 20 per 10 minutes — is then scoped to one simulated household
 * member, which is what those limits are for. Lumped into a single address, a
 * suite that navigates a few dozen times in ninety seconds is indistinguishable
 * from an attack, and the 429 on /api/auth/me reads to the SPA as "signed out".
 */
export function clientAddress(): string {
  counter += 1;
  return `10.77.${Math.floor(counter / 250) % 250}.${(counter % 250) + 1}`;
}

/** The header pair the app reads that address from. */
export function clientAddressHeaders(): Record<string, string> {
  return { "X-Forwarded-For": clientAddress() };
}

/** Playwright's own wait, used only where a fixed window genuinely has to
 * elapse (see signIn). Never as a substitute for waiting on state. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function body(response: APIResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

/**
 * POSTs with a bounded retry on 429.
 *
 * The auth routes are rate limited per client address — sign-in 5/minute,
 * reset requests 3 per 5 minutes, two-factor verification 5/minute (see
 * apps/server/internal/auth/auth.go) — and every request in the suite comes
 * from one address. Real users never hit those; a suite that signs a handful
 * of accounts in seconds does. The limits stay as they are and the harness
 * backs off, rather than the app being weakened for the tests.
 */
async function postWithBackoff(
  request: APIRequestContext,
  url: string,
  options: Parameters<APIRequestContext["post"]>[1],
): Promise<APIResponse> {
  let response = await request.post(url, options);
  for (let attempt = 0; response.status() === 429 && attempt < 12; attempt++) {
    await sleep(6_000);
    response = await request.post(url, options);
  }
  return response;
}

/** The Origin every state-changing API call carries: both the app's same-site
 * guard and Limen's own origin check compare it against APP_URL. A browser
 * sets it automatically; an APIRequestContext does not. */
const originHeader = { Origin: BASE_URL };

// ------------------------------------------------------------------ setup

export interface SetupStatus {
  status: string;
  needsSetup: boolean;
  setupLocked: boolean;
  emailDomain?: string;
}

export async function setupStatus(
  request: APIRequestContext,
): Promise<SetupStatus> {
  const response = await request.get(`${BASE_URL}/api/setup/status`);
  expect(response.ok(), `setup status: ${response.status()}`).toBeTruthy();
  return (await response.json()) as SetupStatus;
}

/**
 * Completes first-run setup, once per stack.
 *
 * `/setup` can only ever succeed once against a given database, so this is
 * idempotent by design: a stack that is already configured answers 409 and the
 * owner is signed in with their password instead. That is what lets
 * global-setup.ts run against a fresh stack and against one left up from an
 * earlier `bunx playwright test` alike.
 */
export async function completeSetup(request: APIRequestContext): Promise<void> {
  const status = await setupStatus(request);

  if (status.needsSetup) {
    const response = await postWithBackoff(
      request,
      `${BASE_URL}/api/setup/complete`,
      {
        headers: originHeader,
        data: {
          email: OWNER_EMAIL,
          name: OWNER_NAME,
          password: PASSWORD,
          householdName: OWNER_HOUSEHOLD,
          householdSlug: OWNER_SLUG,
          setupSecret: SETUP_SECRET,
        },
      },
    );
    // 409 means somebody (a previous run) got there first — fall through to
    // the sign-in below rather than failing a perfectly usable stack.
    if (response.status() !== 409) {
      expect(
        response.status(),
        `setup: ${response.status()} ${JSON.stringify(await body(response))}`,
      ).toBe(201);
      return;
    }
  }

  await apiSignIn(request, OWNER_EMAIL, PASSWORD);
}

// ------------------------------------------------------------------- auth

/**
 * Signs in over the API. The session cookie lands in the caller's cookie jar,
 * so a page built on the same context is signed in too. The login SCREEN is
 * driven by signIn() below, which auth.spec.ts and two-factor.spec.ts use —
 * every other spec takes this door, because their subject is elsewhere and
 * each extra sign-in eats the 5-per-minute allowance.
 */
export async function apiSignIn(
  request: APIRequestContext,
  email: string,
  password: string = PASSWORD,
): Promise<void> {
  const response = await postWithBackoff(
    request,
    `${BASE_URL}/api/auth/signin/credential`,
    { headers: originHeader, data: { credential: email, password } },
  );
  expect(
    response.ok(),
    `sign-in for ${email}: ${response.status()} ${JSON.stringify(await body(response))}`,
  ).toBeTruthy();
}

/**
 * Signs in through the real login screen.
 *
 * The submit is watched at the network level rather than by reading the error
 * alert: a 429 from the shared limiter and a genuinely wrong password both
 * render an alert, and only one of them is worth retrying. The fixed window is
 * a minute long, so nothing shorter than a wait gets back in — this is the one
 * place in the suite where time itself has to pass.
 *
 * Resolves once the response is in; the caller asserts where the app landed
 * (an account with two-step verification on goes to /two-factor, not home).
 */
export async function signIn(
  page: Page,
  email: string,
  password: string = PASSWORD,
): Promise<void> {
  await page.goto("/login");
  // Accessible names, not label text: MUI appends an aria-hidden "*" to the
  // <label> of a required field, so the label's own text is "Password *".
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(email);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);

  for (let attempt = 0; ; attempt++) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/auth/signin/credential") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    if (response.status() !== 429 || attempt >= 12) return;
    await sleep(6_000);
  }
}

/** Signs out through the account menu in the app bar. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
}

/** Answers the two-step challenge on /two-factor with the code given. */
export async function submitChallengeCode(
  page: Page,
  code: string,
): Promise<void> {
  const field = page.getByLabel(/Authenticator code|Backup code/);
  await field.fill(code);

  for (let attempt = 0; ; attempt++) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/auth/two-factor/verify") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Verify" }).click(),
    ]);
    if (response.status() !== 429 || attempt >= 12) return;
    await sleep(6_000);
  }
}

/** The current 6-digit code for an otpauth:// URI, as an authenticator app
 * would show it. */
export function totpFrom(uri: string): string {
  const totp = URI.parse(uri);
  if (!(totp instanceof TOTP)) {
    throw new Error(`not a TOTP URI: ${uri}`);
  }
  return totp.generate();
}

/**
 * A code the account has not answered with before.
 *
 * A TOTP is only valid once: finishing enrolment and then signing in a couple
 * of seconds later would otherwise present the same six digits inside the same
 * 30-second window, and the server is right to refuse them. Waiting for the
 * period to roll over is what a person with a phone does too — and it is a
 * wait on the code CHANGING, not a fixed sleep.
 */
export async function nextTotp(uri: string, previous: string): Promise<string> {
  const deadline = Date.now() + 40_000;
  let code = totpFrom(uri);
  while (code === previous) {
    if (Date.now() > deadline) {
      throw new Error("the TOTP period never rolled over");
    }
    await sleep(500);
    code = totpFrom(uri);
  }
  return code;
}

// ---------------------------------------------------------------- mailpit

interface MailpitSummary {
  ID: string;
  Subject: string;
}

export interface CapturedMail {
  id: string;
  subject: string;
  text: string;
  /** The first link back into the app — the invitation or reset link. */
  link: string;
}

const appLinkPattern = new RegExp(
  `${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^\\s<>"']+`,
);

export const mailpit = {
  /** Everything Mailpit is holding, deleted. Specs that read "the latest mail
   * to X" call this first when the same address is written to twice. */
  async deleteAll(request: APIRequestContext): Promise<void> {
    const response = await request.delete(`${MAILPIT_URL}/api/v1/messages`);
    expect(response.ok(), `mailpit delete: ${response.status()}`).toBeTruthy();
  },

  /**
   * The newest message delivered to `email`, with the app link from its plain
   * text body already extracted.
   *
   * Mail leaves the app on the request that triggered it, but Mailpit indexes
   * it a moment later, so this polls the search endpoint rather than assuming
   * it is there — a wait on state, not a sleep.
   */
  async lastMessageTo(
    request: APIRequestContext,
    email: string,
    options: { timeout?: number; after?: string } = {},
  ): Promise<CapturedMail> {
    const deadline = Date.now() + (options.timeout ?? 15_000);
    let summary: MailpitSummary | undefined;

    while (!summary) {
      const response = await request.get(
        `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      );
      if (response.ok()) {
        const found = (await response.json()) as {
          messages?: MailpitSummary[];
        };
        // Newest first. `after` is the id of the message this caller has
        // already read, so "the reset link" and "the resent invitation" wait
        // for the NEW mail instead of racing the old one still sitting there.
        const newest = found.messages?.[0];
        summary = newest && newest.ID !== options.after ? newest : undefined;
      }
      if (!summary) {
        if (Date.now() > deadline) {
          throw new Error(
            `no new mail delivered to ${email} within the timeout`,
          );
        }
        await sleep(250);
      }
    }

    const detail = await request.get(
      `${MAILPIT_URL}/api/v1/message/${summary.ID}`,
    );
    expect(
      detail.ok(),
      `mailpit message ${summary.ID}: ${detail.status()}`,
    ).toBeTruthy();
    const message = (await detail.json()) as { Subject: string; Text: string };
    const link = appLinkPattern.exec(message.Text ?? "")?.[0] ?? "";

    return {
      id: summary.ID,
      subject: message.Subject,
      text: message.Text ?? "",
      link,
    };
  },
};

// --------------------------------------------------------- inbound mail

export interface InboundMail {
  /** Envelope recipient: `<slug>@e2e.test`. */
  to: string;
  /** Envelope sender, also used as the From header unless headerFrom is set. */
  from: string;
  headerFrom?: string;
  subject: string;
  text: string;
  /** X-Mailgun-Spf. Omit for a message with no authentication annotation at
   * all, which the verdict treats as "nothing to check". */
  spf?: string;
  /** X-Mailgun-Dkim-Check-Result. */
  dkim?: string;
}

/** One RFC 5322 message, the shape Mailgun puts in `body-mime`. */
function rawMessage(mail: InboundMail): string {
  const lines = [`From: Service <${mail.headerFrom ?? mail.from}>`];
  if (mail.spf) lines.push(`X-Mailgun-Spf: ${mail.spf}`);
  if (mail.dkim) lines.push(`X-Mailgun-Dkim-Check-Result: ${mail.dkim}`);
  lines.push(
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}@${EMAIL_DOMAIN}>`,
    `Date: ${new Date().toUTCString()}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    mail.text,
  );
  return lines.join("\r\n");
}

let tokenCounter = 0;

/**
 * Delivers one message the way Mailgun would: a multipart form carrying the
 * raw message in `body-mime`, signed with the stack's webhook key
 * (hex HMAC-SHA256 over timestamp+token). This is the only way into the
 * pipeline — there is no test-only ingest route — so the suite exercises the
 * signature check, the MIME parse, the classifier and the extractor together.
 */
export async function postInbound(
  request: APIRequestContext,
  mail: InboundMail,
): Promise<APIResponse> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  tokenCounter += 1;
  const token = `e2e-token-${Date.now().toString(36)}-${tokenCounter}`;
  const signature = createHmac("sha256", MAILGUN_SIGNING_KEY)
    .update(timestamp + token)
    .digest("hex");

  const response = await request.post(`${BASE_URL}/api/inbound/mailgun/mime`, {
    multipart: {
      recipient: mail.to,
      sender: mail.from,
      timestamp,
      token,
      signature,
      "body-mime": rawMessage(mail),
    },
  });
  expect(
    response.status(),
    `inbound delivery: ${response.status()} ${JSON.stringify(await body(response))}`,
  ).toBe(200);
  return response;
}

// ------------------------------------------------------- app API shortcuts

/** An API context signed in as the owner, for the seeding a spec's subject is
 * not. Dispose it when done. */
export function ownerApi(): Promise<APIRequestContext> {
  return apiRequest.newContext({
    baseURL: BASE_URL,
    storageState: OWNER_STATE,
    extraHTTPHeaders: clientAddressHeaders(),
  });
}

/**
 * An API context with no session at all — spelled out, because inside a test
 * `request.newContext()` inherits the storage state the file put in `use`, and
 * an "anonymous" caller that turns out to be the owner silently changes what
 * an endpoint does (invitation acceptance answers 403 to the wrong account).
 */
export function anonymousApi(): Promise<APIRequestContext> {
  return apiRequest.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: clientAddressHeaders(),
  });
}

export interface Service {
  id: string;
  providerKey: string;
  displayName: string;
}

/** Creates a service (and optionally its first domain sender) for a household.
 * The caller's context must be an owner of `slug`. */
export async function createService(
  request: APIRequestContext,
  slug: string,
  options: { key: string; name: string; senderDomain?: string },
): Promise<Service> {
  const created = await request.post(
    `${BASE_URL}/api/admin/${slug}/providers`,
    {
      headers: originHeader,
      data: { providerKey: options.key, displayName: options.name },
    },
  );
  expect(
    created.status(),
    `create service: ${created.status()} ${JSON.stringify(await body(created))}`,
  ).toBe(201);
  const provider = ((await created.json()) as { provider: { id: string } })
    .provider;

  if (options.senderDomain) {
    const rule = await request.post(
      `${BASE_URL}/api/admin/${slug}/provider-rules`,
      {
        headers: originHeader,
        data: {
          providerId: provider.id,
          matchType: "domain",
          matchValue: options.senderDomain,
        },
      },
    );
    expect(
      rule.status(),
      `create sender rule: ${rule.status()} ${JSON.stringify(await body(rule))}`,
    ).toBe(201);
  }

  return {
    id: provider.id,
    providerKey: options.key,
    displayName: options.name,
  };
}

export interface Invitation {
  token: string;
  url: string;
  emailSent: boolean;
  email: string;
  id: string;
}

/** Issues an invitation as the owner. Returns the link the invitee would get
 * (which is also what the "share this link" dialog shows). */
export async function invite(
  request: APIRequestContext,
  slug: string,
  options: {
    email: string;
    name: string;
    role?: "member" | "owner";
    providerIds?: string[];
  },
): Promise<Invitation> {
  const response = await request.post(
    `${BASE_URL}/api/admin/${slug}/invitations`,
    {
      headers: originHeader,
      data: {
        email: options.email,
        name: options.name,
        role: options.role ?? "member",
        providerIds: options.providerIds ?? [],
      },
    },
  );
  expect(
    response.status(),
    `invite: ${response.status()} ${JSON.stringify(await body(response))}`,
  ).toBe(201);

  const result = (await response.json()) as {
    invitation: { id: string; email: string };
    inviteUrl: string;
    emailSent: boolean;
  };
  return {
    id: result.invitation.id,
    email: result.invitation.email,
    url: result.inviteUrl,
    token: result.inviteUrl.split("/invite/")[1] ?? "",
    emailSent: result.emailSent,
  };
}

/**
 * Accepts an invitation as a brand-new account. The caller's context must be
 * signed OUT; the response sets that context's session cookie, so the new
 * member is signed in afterwards and their storage state can be saved.
 */
export async function acceptInvitation(
  request: APIRequestContext,
  token: string,
  options: { name: string; password?: string },
): Promise<{ slug: string }> {
  const response = await postWithBackoff(
    request,
    `${BASE_URL}/api/invitations/accept`,
    {
      headers: { ...originHeader, "X-Invitation-Token": token },
      data: { name: options.name, password: options.password ?? PASSWORD },
    },
  );
  expect(
    response.ok(),
    `accept invitation: ${response.status()} ${JSON.stringify(await body(response))}`,
  ).toBeTruthy();
  const accepted = (await response.json()) as {
    household?: { slug: string } | null;
  };
  return { slug: accepted.household?.slug ?? "" };
}

/** Nobody signed in. Spelled out because Playwright's default is "whatever
 * the file's `test.use` said". */
export const SIGNED_OUT: BrowserContextOptions["storageState"] = {
  cookies: [],
  origins: [],
};

/**
 * A second (or third) device: its own client address, and a session it has to
 * name. `browser.newContext()` inherits the calling file's
 * `test.use({ storageState })`, which is almost never what a spec spinning up
 * another device means — an "anonymous" invitee that turns out to be the owner
 * takes a completely different branch of the invitation screen.
 */
export function newBrowserContext(
  browser: Browser,
  options: { storageState: BrowserContextOptions["storageState"] },
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    storageState: options.storageState,
    extraHTTPHeaders: clientAddressHeaders(),
  });
}

export interface MemberAccount {
  email: string;
  name: string;
  /** Storage state for a browser context signed in as this member. */
  state: string;
}

/**
 * A brand-new household member, created the way a real one is: the owner
 * issues an invitation, and the invitee accepts it with a name and a password.
 *
 * Acceptance signs the new account in on the spot, so their session is saved
 * to a storage-state file instead of being re-established with a sign-in later
 * — the sign-in route allows five requests a minute across the whole suite,
 * and the specs that spend them are the ones whose subject IS signing in.
 */
export async function createMember(
  slug: string,
  options: {
    tag: string;
    role?: "member" | "owner";
    providerIds?: string[];
  },
): Promise<MemberAccount> {
  const email = freshEmail(options.tag);
  const name = `${options.tag} member`;

  const owner = await ownerApi();
  let invitation: Invitation;
  try {
    invitation = await invite(owner, slug, {
      email,
      name,
      role: options.role,
      providerIds: options.providerIds,
    });
  } finally {
    await owner.dispose();
  }

  const state = `${STATE_DIR}/${email.replace(/[^a-z0-9]+/gi, "-")}.json`;
  const invitee = await anonymousApi();
  try {
    await acceptInvitation(invitee, invitation.token, { name });
    await mkdir(STATE_DIR, { recursive: true });
    await invitee.storageState({ path: state });
  } finally {
    await invitee.dispose();
  }

  return { email, name, state };
}
