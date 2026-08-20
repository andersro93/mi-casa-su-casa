import type { MiddlewareHandler } from "hono";

export type RateLimitRule = {
  /** Short label used in the storage key, e.g. "setup". */
  name: string;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Maximum requests per window per client. */
  max: number;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Resolves the client address. Cloudflare sets cf-connecting-ip on every
 * request that reaches a Worker; it cannot be spoofed by the client.
 */
export function clientAddress(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/**
 * Atomic fixed-window counter in D1 (single upsert with RETURNING), keyed by
 * rule name + client. Shared-table layout with Better Auth's rateLimit model.
 */
export async function consumeRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  client: string,
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  const key = `app:${rule.name}:${client}`;
  const windowMs = rule.windowSeconds * 1000;
  const windowStartCutoff = now - windowMs;

  const row = await db
    .prepare(
      `INSERT INTO rate_limit (id, key, count, last_request)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limit.last_request <= ?4 THEN 1
           ELSE rate_limit.count + 1
         END,
         last_request = CASE
           WHEN rate_limit.last_request <= ?4 THEN ?3
           ELSE rate_limit.last_request
         END
       RETURNING count, last_request`,
    )
    .bind(crypto.randomUUID(), key, now, windowStartCutoff)
    .first<{ count: number; last_request: number }>();

  const count = Number(row?.count ?? 1);
  const lastRequest = Number(row?.last_request ?? now);

  if (count > rule.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((lastRequest + windowMs - now) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, remaining: rule.max - count };
}

/** Hono middleware that enforces `rule` per client address. */
export function rateLimit(
  rule: RateLimitRule,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const decision = await consumeRateLimit(
      c.env.DB,
      rule,
      clientAddress(c.req.raw.headers),
    );

    if (!decision.allowed) {
      c.header("Retry-After", String(decision.retryAfterSeconds));
      return c.json(
        { error: "Too many requests. Please try again later." },
        429,
      );
    }

    await next();
  };
}

export const RATE_LIMITS = {
  /** Guessing SETUP_SECRET must be slow. */
  setup: { name: "setup", windowSeconds: 15 * 60, max: 5 },
  /** Invitation token lookups / acceptance. */
  invitations: { name: "invitations", windowSeconds: 10 * 60, max: 20 },
  /** Household creation by authenticated users. */
  householdCreate: {
    name: "household-create",
    windowSeconds: 60 * 60,
    max: 10,
  },
} as const satisfies Record<string, RateLimitRule>;
