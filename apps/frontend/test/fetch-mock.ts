/**
 * Reading a stubbed `fetch` call.
 *
 * The app dispatches its `/api/*` calls through openapi-fetch, which hands
 * `fetch` a **Request object** rather than the `(url, init)` pair the old
 * hand-rolled `fetchJson` used. `String(input)` on a Request reads
 * "[object Request]", and `init` is undefined, so every mock reads the call
 * through this instead of off the arguments directly.
 */
export type MockedCall = {
  url: string;
  method: string;
  body?: string;
};

export async function readRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<MockedCall> {
  if (input instanceof Request) {
    // Clone before reading: the body is a one-shot stream and the mock may
    // still want to hand the Request on.
    const body =
      input.method === "GET" || input.method === "HEAD"
        ? undefined
        : await input.clone().text();
    return {
      url: input.url,
      method: input.method,
      body: body || undefined,
    };
  }

  return {
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body as string | undefined,
  };
}
