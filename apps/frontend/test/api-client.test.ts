// @vitest-environment jsdom
/**
 * `unwrap` is the seam between openapi-fetch's `{data, error, response}`
 * result and the throw-on-failure shape every screen and every TanStack Query
 * hook is written against, so its failure translation is worth pinning down.
 *
 * jsdom, not node: openapi-fetch builds a `new Request(url)`, and a relative
 * base URL ("" — same origin, which is how this app is served) only resolves
 * where there is a document to resolve it against.
 */
import { describe, expect, it, vi } from "vitest";

import { ApiError, client, unwrap } from "../src/lib/api";

/** The ApiError a call threw, or a failure if it did not throw at all. */
async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the call to reject");
}

function result(status: number, body: unknown, ok = status < 400) {
  return {
    data: ok ? body : undefined,
    error: ok ? undefined : body,
    response: new Response(null, {
      status,
      statusText: status === 403 ? "Forbidden" : "Error",
    }),
  };
}

describe("unwrap", () => {
  it("returns the body of a successful call", async () => {
    await expect(
      unwrap<{ ok: boolean }>(result(200, { ok: true })),
    ).resolves.toEqual({ ok: true });
  });

  it("accepts the call unawaited", async () => {
    await expect(
      unwrap(Promise.resolve(result(200, { a: 1 }))),
    ).resolves.toEqual({
      a: 1,
    });
  });

  it("throws an ApiError carrying the server's message, code and fields", async () => {
    const error = await failure(
      unwrap(
        result(400, {
          error: "That inbox address is taken.",
          code: "slug_taken",
          fields: { slug: "Already in use." },
        }),
      ),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("That inbox address is taken.");
    expect(error.code).toBe("slug_taken");
    expect(error.fields).toEqual({ slug: "Already in use." });
  });

  it("falls back to the status text when the body is not the error envelope", async () => {
    // openapi-fetch hands back the raw text when a body will not parse as
    // JSON — a proxy's HTML error page, say. Showing that in an alert would
    // paste markup at the user, so the status text is used instead.
    const error = await failure(unwrap(result(403, "<html>Forbidden</html>")));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe("Forbidden");
    expect(error.code).toBeUndefined();
  });

  it("treats a failure with no body at all as a failure", async () => {
    // A 500 with an empty body leaves openapi-fetch's `error` undefined;
    // branching on that instead of on the status would let it through as a
    // successful call resolving to undefined.
    const error = await failure(
      unwrap({
        error: undefined,
        response: new Response(null, { status: 500, statusText: "" }),
      }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.message).toBe("Request failed with status 500");
  });
});

describe("client", () => {
  it("fills path parameters and sends the session cookie", async () => {
    const seen: Array<{ url: string; credentials: string }> = [];
    const fetchMock = vi.fn(
      async (request: { url: string; credentials: string }) => {
        seen.push({ url: request.url, credentials: request.credentials });
        return new Response(JSON.stringify({ providers: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await unwrap(
      client.GET("/api/inbox/{slug}/providers", {
        params: { path: { slug: "casa" } },
      }),
    );

    expect(seen[0].url).toContain("/api/inbox/casa/providers");
    expect(seen[0].credentials).toBe("include");
    vi.unstubAllGlobals();
  });
});
