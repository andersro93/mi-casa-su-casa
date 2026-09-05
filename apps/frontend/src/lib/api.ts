/**
 * The typed HTTP client for every `/api/*` route the Go server serves.
 *
 * `api-schema.d.ts` is generated from `openapi/mi-casa.yaml` (root script
 * `npm run gen:client`) and committed; `test/api-schema.test.ts` fails if the
 * spec moves without it. That generated `paths` type is what makes
 * `client.GET("/api/inbox/{slug}/providers", …)` check its path parameters,
 * its query string and its request body at compile time — the whole point of
 * replacing the old hand-rolled `fetchJson`, which built URLs by string
 * concatenation.
 *
 * Response types are the one half that is NOT compile-checked: `unwrap<T>`
 * casts, so the `T` a call site names is an assertion about what the server
 * sends, not a proof. Naming the generated response type is what keeps the
 * assertion honest, and `test/api-schema.test.ts` keeps the generated types
 * in step with the spec.
 */
import createClient from "openapi-fetch";
import type { paths } from "./api-schema";

/**
 * Same origin — the Go binary serves the SPA and the API together, and `vite
 * dev` proxies `/api` to it (vite.config.ts) — so this is the page's own
 * origin rather than a build flag.
 *
 * It is the origin and not `""` because openapi-fetch builds a
 * `new Request(url)`, and only a *browser's* Request resolves a relative URL
 * against the document. Under jsdom the global Request is Node's, which
 * rejects one outright, so a relative base would work in production and
 * throw `ERR_INVALID_URL` in every test that exercises a real call.
 */
export const API_BASE =
  typeof window === "undefined" ? "" : window.location.origin;

export const client = createClient<paths>({
  baseUrl: API_BASE,
  // The session lives in an HttpOnly cookie; without this a cross-origin
  // build would send none of it.
  credentials: "include",
  // openapi-fetch captures `globalThis.fetch` once, when the client is
  // created — which for a module-scope client is import time. Dispatching
  // through a closure instead means a later replacement (a test's
  // `vi.stubGlobal("fetch", …)`, a polyfill) is still honoured, and costs one
  // property lookup per call.
  fetch: (request: Request) => globalThis.fetch(request),
});

/**
 * A failed `/api/*` call. `message` is the server's own `error` string, so
 * screens keep showing the wording the API chose; `code` is the stable
 * discriminator the few branching call sites read, and `fields` maps a
 * rejected input's name to its message (`_` for the body as a whole).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    message: string,
    code?: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** The `{error, code?, fields?}` envelope every failure in the spec uses. */
type ErrorEnvelope = {
  error?: string;
  code?: string;
  fields?: Record<string, string>;
};

/**
 * openapi-fetch resolves to `{data, error, response}` instead of throwing.
 * `unwrap` turns that back into the throw-on-failure shape every call site
 * already expects — TanStack Query treats a rejected promise as the error
 * state, and the screens all render `err instanceof Error ? err.message`.
 *
 * It takes the call unawaited, so a call site reads as one expression:
 * `unwrap(client.GET("/api/settings"))`.
 *
 * `data` is deliberately `unknown` on the parameter and cast to `T` on the
 * way out: inference through openapi-fetch's promise-wrapped, two-branch
 * union does not survive a generic wrapper, and every call site names its own
 * `T` (which is the generated response type, passed explicitly).
 */
interface OpenApiFetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

export async function unwrap<T = unknown>(
  call: OpenApiFetchResult | Promise<OpenApiFetchResult>,
): Promise<T> {
  const { data, error, response } = await call;

  // Branch on the status, not on `error`: openapi-fetch leaves `error`
  // undefined for a failure with an empty body, and sets it to the raw *text*
  // when the body would not parse as JSON. Only `response.ok` reliably says
  // whether the call succeeded.
  if (!response.ok) {
    const body =
      typeof error === "object" && error !== null
        ? (error as ErrorEnvelope)
        : {};
    // A non-JSON body (a proxy's HTML error page, say) is deliberately not
    // shown: `statusText` is the honest fallback and does not paste markup
    // into an alert.
    const message =
      body.error ||
      response.statusText ||
      `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, body.code, body.fields);
  }

  // 204s (session revocation, member removal, …) carry no body; the call
  // sites that see one type `T` as `void`.
  return data as T;
}
