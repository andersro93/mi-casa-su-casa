import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The origin (scheme + host + port) the SPA is served from. */
export function appOrigin(env: Pick<Env, "APP_URL">): string | null {
  try {
    return new URL(env.APP_URL).origin;
  } catch {
    return null;
  }
}

function isLocalDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

/**
 * Decides whether a request Origin may receive credentialed CORS responses.
 * Only the app's own origin is allowed (plus localhost during development).
 * Returns the allowed origin string, or "" to omit the CORS headers entirely.
 */
export function corsOriginFor(
  env: Pick<Env, "APP_URL" | "ENVIRONMENT">,
  origin: string | undefined,
): string {
  if (!origin) {
    return "";
  }

  if (origin === appOrigin(env)) {
    return origin;
  }

  if (env.ENVIRONMENT === "development" && isLocalDevOrigin(origin)) {
    return origin;
  }

  return "";
}

/**
 * Cross-site request forgery guard for cookie-authenticated mutations.
 *
 * Browsers always send `Sec-Fetch-Site` and, for non-GET requests, `Origin`.
 * A request that carries either header with a foreign value is rejected.
 * Requests without any of these headers (curl, tests, server-to-server) are
 * not browser-initiated and therefore not CSRF vectors, so they pass.
 */
export const rejectCrossSiteMutations: MiddlewareHandler<{
  Bindings: Env;
}> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    return next();
  }

  const allowed = appOrigin(c.env);
  const fetchSite = c.req.header("sec-fetch-site");
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");

  const originAllowed = (candidate: string) =>
    corsOriginFor(c.env, candidate) !== "" ||
    (allowed !== null && candidate === allowed);

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    // cross-site / same-site(sibling subdomain): only allow if Origin matches
    // exactly (a dev server on another localhost port, for example).
    if (!origin || !originAllowed(origin)) {
      return c.json({ error: "Cross-site request rejected" }, 403);
    }
  }

  if (origin && !originAllowed(origin)) {
    return c.json({ error: "Cross-site request rejected" }, 403);
  }

  if (!origin && referer) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
    if (!refererOrigin || !originAllowed(refererOrigin)) {
      return c.json({ error: "Cross-site request rejected" }, 403);
    }
  }

  await next();
};
