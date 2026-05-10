import { describe, expect, it } from "vitest";

import worker from "../src/index";

type WorkerFetch = NonNullable<typeof worker.fetch>;

function createEnv(overrides?: Partial<Env>): Env {
  const db = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ ok: 1 }),
        run: async () => ({ results: [] }),
      }),
      first: async () => ({ ok: 1 }),
      run: async () => ({ results: [] }),
    }),
    batch: async () => [],
  } as unknown as D1Database;

  const assets = {
    fetch: async () => new Response("spa"),
  } as unknown as Fetcher;

  const email = {
    send: async () => {},
  } as unknown as SendEmail;

  return {
    APP_NAME: "Mi Casa Su Casa",
    APP_ORIGIN: "http://localhost:8787",
    ASSETS: assets,
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    DB: db,
    EMAIL: email,
    ENVIRONMENT: "test",
    ...overrides,
  };
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function getWorkerFetch(): WorkerFetch {
  if (!worker.fetch) {
    throw new Error("Worker fetch handler is unavailable");
  }

  return worker.fetch;
}

describe("worker routes", () => {
  it("returns liveness health", async () => {
    const fetchHandler = getWorkerFetch();
    const request = new Request(
      "http://localhost:8787/api/health/live",
    ) as Parameters<WorkerFetch>[0];

    const response = await fetchHandler(
      request,
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
