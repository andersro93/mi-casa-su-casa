import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionUser = {
  id: string;
  email: string;
  role: string;
};

type DbRunner = {
  first?: () => Promise<unknown>;
  run?: () => Promise<{ results: unknown[] }>;
};

type DbResolver = (sql: string, params: unknown[]) => DbRunner;

const sessionState = vi.hoisted(() => ({
  current: null as {
    user: SessionUser;
    session: { id: string; userId: string };
  } | null,
}));

vi.mock("../src/server/auth/auth", () => ({
  authForEnv: () => ({
    handler: () => new Response("auth"),
    api: {
      getSession: async () => sessionState.current,
    },
  }),
}));

const { default: worker } = await import("../src/index");

type WorkerFetch = NonNullable<typeof worker.fetch>;

function createDbStub(resolve: DbResolver): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const runner = resolve(sql, params);

          return {
            first: async () => runner.first?.(),
            run: async () => runner.run?.() ?? { results: [] },
          };
        },
        first: async () => resolve(sql, []).first?.(),
        run: async () => resolve(sql, []).run?.() ?? { results: [] },
      };
    },
    batch: async () => [],
  } as unknown as D1Database;
}

function createEnv(db: D1Database): Env {
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

async function invokeWorker(
  path: string,
  options: RequestInit | undefined,
  db: D1Database,
) {
  const fetchHandler = getWorkerFetch();
  const request = new Request(
    `http://localhost:8787${path}`,
    options,
  ) as Parameters<WorkerFetch>[0];

  return fetchHandler(request, createEnv(db), createExecutionContext());
}

describe("worker routes", () => {
  beforeEach(() => {
    sessionState.current = null;
  });

  it("returns liveness health", async () => {
    const db = createDbStub((sql) => {
      if (sql.includes("SELECT 1 AS ok")) {
        return {
          first: async () => ({ ok: 1 }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/health/live", undefined, db);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("lists providers available to the signed-in user", async () => {
    sessionState.current = {
      user: { id: "user-1", email: "member@example.com", role: "member" },
      session: { id: "session-1", userId: "user-1" },
    };

    const db = createDbStub((sql) => {
      if (sql.includes("GROUP BY providers.id")) {
        return {
          run: async () => ({
            results: [
              {
                provider_key: "netflix",
                display_name: "Netflix",
                message_count: 2,
                new_count: 1,
                latest_received_at: "2026-05-10T12:00:00.000Z",
              },
            ],
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/inbox/providers", undefined, db);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers: [
        {
          provider_key: "netflix",
          display_name: "Netflix",
          message_count: 2,
          new_count: 1,
          latest_received_at: "2026-05-10T12:00:00.000Z",
        },
      ],
    });
  });

  it("updates message status for a permitted provider member", async () => {
    sessionState.current = {
      user: { id: "user-1", email: "member@example.com", role: "member" },
      session: { id: "session-1", userId: "user-1" },
    };

    const db = createDbStub((sql, params) => {
      if (sql.includes("WHERE messages.id = ?") && sql.includes("LIMIT 1")) {
        return {
          first: async () => ({
            id: params[0],
            provider_key: "netflix",
            provider_display_name: "Netflix",
            subject: "Your latest code",
            from_header: "Netflix <login@netflix.example>",
            text_body: "Use 123456 to continue",
            extracted_code: "123456",
            status: "used",
            received_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      if (sql.includes("SELECT 1 AS allowed")) {
        return {
          first: async () => ({ allowed: 1 }),
        };
      }

      if (sql.startsWith("UPDATE messages SET status = ?")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/inbox/messages/msg-1/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "used" }),
      },
      db,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: {
        id: "msg-1",
        provider_key: "netflix",
        provider_display_name: "Netflix",
        subject: "Your latest code",
        from_header: "Netflix <login@netflix.example>",
        text_body: "Use 123456 to continue",
        extracted_code: "123456",
        status: "used",
        received_at: "2026-05-10T12:00:00.000Z",
      },
    });
  });

  it("rejects invalid status payloads", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub((sql, params) => {
      if (sql.includes("WHERE messages.id = ?") && sql.includes("LIMIT 1")) {
        return {
          first: async () => ({
            id: params[0],
            provider_key: "netflix",
            provider_display_name: "Netflix",
            subject: "Your latest code",
            from_header: "Netflix <login@netflix.example>",
            text_body: "Use 123456 to continue",
            extracted_code: "123456",
            status: "new",
            received_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/inbox/messages/msg-1/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      },
      db,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid message status",
    });
  });

  it("allows an owner to release a quarantined message to a provider", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub((sql, params) => {
      if (
        sql.includes("FROM providers") &&
        sql.includes("WHERE provider_key = ?")
      ) {
        return {
          first: async () => ({
            id: "provider-1",
            provider_key: "netflix",
            display_name: "Netflix",
          }),
        };
      }

      if (
        sql.includes("FROM quarantine_messages") &&
        sql.includes("WHERE id = ?")
      ) {
        return {
          first: async () => ({
            id: params[0],
            message_id: "message-123",
            envelope_from: "login@netflix.example",
            envelope_to: "codes@example.com",
            from_header: "Netflix <login@netflix.example>",
            subject: "Netflix code",
            text_body: "Use 123456",
            extracted_code: "123456",
            quarantine_reason: "No sender rule matched",
            raw_size: 512,
            received_at: "2026-05-10T12:00:00.000Z",
            delete_after: "2026-06-09T12:00:00.000Z",
            reviewed_at: null,
          }),
        };
      }

      if (sql.startsWith("INSERT INTO messages")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("WHERE messages.message_id = ?")) {
        return {
          first: async () => ({
            id: "released-1",
            provider_key: "netflix",
            provider_display_name: "Netflix",
            subject: "Netflix code",
            from_header: "Netflix <login@netflix.example>",
            text_body: "Use 123456",
            extracted_code: "123456",
            status: "new",
            received_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      if (sql.startsWith("UPDATE quarantine_messages SET reviewed_at = ?")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/inbox/quarantine/quarantine-1/review",
      {
        method: "POST",
        body: JSON.stringify({ action: "release", providerKey: "netflix" }),
      },
      db,
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      reviewedAt: string;
      releasedMessage: { id: string; provider_key: string; status: string };
    };

    expect(payload.reviewedAt).toMatch(/T/);
    expect(payload.releasedMessage).toMatchObject({
      id: "released-1",
      provider_key: "netflix",
      status: "new",
    });
  });

  it("keeps quarantine owner-only", async () => {
    sessionState.current = {
      user: { id: "user-1", email: "member@example.com", role: "member" },
      session: { id: "session-1", userId: "user-1" },
    };

    const db = createDbStub(() => ({}));

    const response = await invokeWorker("/api/inbox/quarantine", undefined, db);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
