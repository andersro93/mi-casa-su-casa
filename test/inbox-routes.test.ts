import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionUser = {
  id: string;
  email: string;
  role: string;
};

type DbRunner = {
  all?: () => Promise<{ results: unknown[] }>;
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

const authApiState = vi.hoisted(() => ({
  createUserCalls: [] as unknown[],
  listUsersCalls: [] as unknown[],
  signInEmailCalls: [] as unknown[],
  setRoleCalls: [] as unknown[],
  setPasswordCalls: [] as unknown[],
  listUsersResponse: {
    users: [] as Array<{ id: string; email: string; role: string }>,
    total: 0,
  },
}));

vi.mock("../src/server/auth/auth", () => ({
  authForEnv: () => ({
    handler: () => new Response("auth"),
    api: {
      getSession: async () => sessionState.current,
      createUser: async (input: unknown) => {
        authApiState.createUserCalls.push(input);

        return {
          user: {
            id: "created-user-1",
            email: "new@example.com",
            name: "New Person",
            role: "member",
          },
        };
      },
      setRole: async (input: unknown) => {
        authApiState.setRoleCalls.push(input);
        return { ok: true };
      },
      listUsers: async (input: unknown) => {
        authApiState.listUsersCalls.push(input);
        return authApiState.listUsersResponse;
      },
      signInEmail: async (input: unknown) => {
        authApiState.signInEmailCalls.push(input);
        return {
          response: {
            session: {
              id: "setup-session-1",
              userId: "created-user-1",
            },
          },
          headers: new Headers({
            "set-cookie":
              "better-auth.session_token=test-token; Path=/; HttpOnly",
          }),
        };
      },
      setUserPassword: async (input: unknown) => {
        authApiState.setPasswordCalls.push(input);
        return { ok: true };
      },
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
          const runner = resolve(sql.trim(), params);

          return {
            all: async () => {
              if (runner.all) {
                return runner.all();
              }

              if (runner.run) {
                return runner.run();
              }

              const first = await runner.first?.();
              return { results: first === undefined ? [] : [first] };
            },
            first: async () => runner.first?.(),
            run: async () => runner.run?.() ?? { results: [] },
          };
        },
        all: async () => {
          const runner = resolve(sql.trim(), []);

          if (runner.all) {
            return runner.all();
          }

          if (runner.run) {
            return runner.run();
          }

          const first = await runner.first?.();
          return { results: first === undefined ? [] : [first] };
        },
        first: async () => resolve(sql.trim(), []).first?.(),
        run: async () => resolve(sql.trim(), []).run?.() ?? { results: [] },
      };
    },
    batch: async () => [],
  } as unknown as D1Database;
}

function createEnv(db: D1Database, overrides?: Partial<Env>): Env {
  const assets = {
    fetch: async () => new Response("spa"),
  } as unknown as Fetcher;

  const email = {
    send: async () => {},
  } as unknown as SendEmail;

  return {
    APP_NAME: "Mi Casa Su Casa",
    APP_URL: "http://localhost:8787",
    ASSETS: assets,
    AUTH_SECRET: "test-secret",
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

async function invokeWorker(
  path: string,
  options: RequestInit | undefined,
  db: D1Database,
  envOverrides?: Partial<Env>,
) {
  const fetchHandler = getWorkerFetch();
  const request = new Request(
    `http://localhost:8787${path}`,
    options,
  ) as Parameters<WorkerFetch>[0];

  return fetchHandler(
    request,
    createEnv(db, envOverrides),
    createExecutionContext(),
  );
}

describe("worker routes", () => {
  beforeEach(() => {
    sessionState.current = null;
    authApiState.createUserCalls = [];
    authApiState.listUsersCalls = [];
    authApiState.signInEmailCalls = [];
    authApiState.setRoleCalls = [];
    authApiState.setPasswordCalls = [];
    authApiState.listUsersResponse = {
      users: [],
      total: 0,
    };
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

  it("bootstraps OWNER_EMAIL to admin via direct D1 update", async () => {
    sessionState.current = {
      user: { id: "user-1", email: "owner@example.com", role: "member" },
      session: { id: "session-1", userId: "user-1" },
    };

    const dbCalls: Array<{ sql: string; params: unknown[] }> = [];

    const db = createDbStub((sql, params) => {
      dbCalls.push({ sql, params });

      if (sql.includes("GROUP BY providers.id")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("UPDATE user SET role = 'admin' WHERE id = ?")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/inbox/providers", undefined, db, {
      OWNER_EMAIL: "owner@example.com",
    });

    expect(response.status).toBe(200);

    const roleUpdate = dbCalls.find((c) =>
      c.sql.includes("UPDATE user SET role = 'admin' WHERE id = ?"),
    );
    expect(roleUpdate).toBeDefined();
    expect(roleUpdate?.params).toEqual(["user-1"]);
  });

  it("does NOT auto-promote when user is not the owner", async () => {
    sessionState.current = {
      user: { id: "user-2", email: "member@example.com", role: "member" },
      session: { id: "session-2", userId: "user-2" },
    };

    const dbCalls: Array<{ sql: string; params: unknown[] }> = [];

    const db = createDbStub((sql, params) => {
      dbCalls.push({ sql, params });

      if (sql.includes("GROUP BY providers.id")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/inbox/providers", undefined, db, {
      OWNER_EMAIL: "owner@example.com",
    });

    expect(response.status).toBe(200);

    const roleUpdate = dbCalls.find((c) =>
      c.sql.includes("UPDATE user SET role = 'admin' WHERE id = ?"),
    );
    expect(roleUpdate).toBeUndefined();
  });

  it("does NOT auto-promote when owner already has admin role", async () => {
    sessionState.current = {
      user: { id: "user-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "user-1" },
    };

    const dbCalls: Array<{ sql: string; params: unknown[] }> = [];

    const db = createDbStub((sql, params) => {
      dbCalls.push({ sql, params });

      if (sql.includes("GROUP BY providers.id")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/inbox/providers", undefined, db, {
      OWNER_EMAIL: "owner@example.com",
    });

    expect(response.status).toBe(200);

    const roleUpdate = dbCalls.find((c) =>
      c.sql.includes("UPDATE user SET role = 'admin' WHERE id = ?"),
    );
    expect(roleUpdate).toBeUndefined();
  });

  it("auto-promotes owner case-insensitively", async () => {
    sessionState.current = {
      user: { id: "user-1", email: "Owner@Example.COM", role: "member" },
      session: { id: "session-1", userId: "user-1" },
    };

    const dbCalls: Array<{ sql: string; params: unknown[] }> = [];

    const db = createDbStub((sql, params) => {
      dbCalls.push({ sql, params });

      if (sql.includes("GROUP BY providers.id")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("UPDATE user SET role = 'admin' WHERE id = ?")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/inbox/providers", undefined, db, {
      OWNER_EMAIL: "owner@example.com",
    });

    expect(response.status).toBe(200);

    const roleUpdate = dbCalls.find((c) =>
      c.sql.includes("UPDATE user SET role = 'admin' WHERE id = ?"),
    );
    expect(roleUpdate).toBeDefined();
    expect(roleUpdate?.params).toEqual(["user-1"]);
  });

  it("lists members and provider access for owners", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub((sql) => {
      if (
        sql.includes("SELECT id, email, name, role, createdAt, updatedAt") &&
        sql.includes("FROM user") &&
        sql.includes("ORDER BY createdAt ASC")
      ) {
        return {
          run: async () => ({
            results: [
              {
                id: "member-1",
                email: "member@example.com",
                name: "Family Member",
                role: "member",
                createdAt: "2026-05-10T12:00:00.000Z",
                updatedAt: "2026-05-10T12:00:00.000Z",
              },
            ],
          }),
        };
      }

      if (
        sql.includes("LEFT JOIN user_provider_access") &&
        sql.includes("LEFT JOIN providers")
      ) {
        return {
          run: async () => ({
            results: [
              {
                id: "member-1",
                email: "member@example.com",
                name: "Family Member",
                role: "member",
                provider_key: "netflix",
                provider_display_name: "Netflix",
              },
            ],
          }),
        };
      }

      if (
        sql.includes("SELECT id, provider_key, display_name") &&
        sql.includes("FROM providers") &&
        sql.includes("ORDER BY display_name ASC")
      ) {
        return {
          run: async () => ({
            results: [
              {
                id: "provider-1",
                provider_key: "netflix",
                display_name: "Netflix",
              },
            ],
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/admin/members", undefined, db);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: [
        {
          id: "member-1",
          email: "member@example.com",
          name: "Family Member",
          role: "member",
          createdAt: "2026-05-10T12:00:00.000Z",
          updatedAt: "2026-05-10T12:00:00.000Z",
          providerAccess: [
            {
              providerKey: "netflix",
              displayName: "Netflix",
            },
          ],
        },
      ],
      providers: [
        {
          id: "provider-1",
          provider_key: "netflix",
          display_name: "Netflix",
        },
      ],
    });
  });

  it("creates a household member from the admin route", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub(() => ({}));

    const response = await invokeWorker(
      "/api/admin/members",
      {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          name: "New Person",
          password: "temporary-password-123",
          role: "member",
        }),
      },
      db,
    );

    expect(response.status).toBe(201);
    expect(authApiState.createUserCalls).toHaveLength(1);
    expect(authApiState.createUserCalls[0]).toMatchObject({
      body: {
        email: "new@example.com",
        name: "New Person",
        password: "temporary-password-123",
        role: "user",
      },
    });
  });

  it("lists provider configuration for owners", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub((sql) => {
      if (sql.includes("COUNT(sender_rules.id) AS rule_count")) {
        return {
          run: async () => ({
            results: [
              {
                id: "provider-1",
                provider_key: "netflix",
                display_name: "Netflix",
                created_at: "2026-05-10T12:00:00.000Z",
                rule_count: 2,
              },
            ],
          }),
        };
      }

      if (
        sql.includes("SELECT id, provider_id, match_type, match_value, created_at") &&
        sql.includes("FROM sender_rules")
      ) {
        return {
          run: async () => ({
            results: [
              {
                id: "rule-1",
                provider_id: "provider-1",
                match_type: "domain",
                match_value: "netflix.com",
                created_at: "2026-05-10T12:00:00.000Z",
              },
            ],
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/admin/providers", undefined, db);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers: [
        {
          id: "provider-1",
          provider_key: "netflix",
          display_name: "Netflix",
          created_at: "2026-05-10T12:00:00.000Z",
          rule_count: 2,
        },
      ],
      rules: [
        {
          id: "rule-1",
          provider_id: "provider-1",
          match_type: "domain",
          match_value: "netflix.com",
          created_at: "2026-05-10T12:00:00.000Z",
        },
      ],
    });
  });

  it("creates a provider from the admin route", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    let providerInserted = false;

    const db = createDbStub((sql, params) => {
      if (sql.includes("WHERE provider_key = ?") && sql.includes("LIMIT 1")) {
        const providerKey = params[0];

        if (providerKey === "hulu" && providerInserted) {
          return {
            first: async () => ({
              id: "provider-1",
              provider_key: "hulu",
              display_name: "Hulu",
              created_at: "2026-05-10T12:00:00.000Z",
            }),
          };
        }

        return {
          first: async () => null,
        };
      }

      if (sql.startsWith("INSERT INTO providers")) {
        return {
          run: async () => {
            providerInserted = true;
            return { results: [] };
          },
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/admin/providers",
      {
        method: "POST",
        body: JSON.stringify({
          providerKey: "hulu",
          displayName: "Hulu",
        }),
      },
      db,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      provider: {
        id: "provider-1",
        provider_key: "hulu",
        display_name: "Hulu",
        created_at: "2026-05-10T12:00:00.000Z",
      },
    });
  });

  it("creates a sender rule from the admin route", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub((sql, params) => {
      if (sql.includes("WHERE id = ?") && sql.includes("FROM providers")) {
        return {
          first: async () => ({
            id: params[0],
            provider_key: "netflix",
            display_name: "Netflix",
            created_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      if (sql.startsWith("INSERT INTO sender_rules")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("FROM sender_rules") && sql.includes("WHERE id = ?")) {
        return {
          first: async () => ({
            id: params[0],
            provider_id: "provider-1",
            match_type: "domain",
            match_value: "netflix.com",
            created_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/admin/provider-rules",
      {
        method: "POST",
        body: JSON.stringify({
          providerId: "provider-1",
          matchType: "domain",
          matchValue: "@Netflix.com",
        }),
      },
      db,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      rule: {
        id: expect.any(String),
        provider_id: "provider-1",
        match_type: "domain",
        match_value: "netflix.com",
        created_at: "2026-05-10T12:00:00.000Z",
      },
    });
  });

  it("grants provider access from the admin route", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub((sql) => {
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

      if (sql.startsWith("INSERT OR IGNORE INTO user_provider_access")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/admin/members/member-1/provider-access",
      {
        method: "POST",
        body: JSON.stringify({ providerKey: "netflix" }),
      },
      db,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("keeps admin routes owner-only", async () => {
    sessionState.current = {
      user: { id: "user-1", email: "member@example.com", role: "member" },
      session: { id: "session-1", userId: "user-1" },
    };

    const db = createDbStub(() => ({}));

    const response = await invokeWorker("/api/admin/members", undefined, db);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("changes another member's role to admin", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub(() => ({}));

    const response = await invokeWorker(
      "/api/admin/members/member-1/role",
      {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      },
      db,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(authApiState.setRoleCalls).toHaveLength(1);
    expect(authApiState.setRoleCalls[0]).toMatchObject({
      body: { userId: "member-1", role: "admin" },
    });
  });

  it("changes another member's role to member", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub(() => ({}));

    const response = await invokeWorker(
      "/api/admin/members/other-admin-2/role",
      {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
      },
      db,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(authApiState.setRoleCalls).toHaveLength(1);
    expect(authApiState.setRoleCalls[0]).toMatchObject({
      body: { userId: "other-admin-2", role: "user" },
    });
  });

  it("prevents admin from changing their own role", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub(() => ({}));

    const response = await invokeWorker(
      "/api/admin/members/admin-1/role",
      {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
      },
      db,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Cannot change your own role. Ask another admin.",
    });
    expect(authApiState.setRoleCalls).toHaveLength(0);
  });

  it("rejects invalid role value", async () => {
    sessionState.current = {
      user: { id: "admin-1", email: "owner@example.com", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };

    const db = createDbStub(() => ({}));

    const response = await invokeWorker(
      "/api/admin/members/member-1/role",
      {
        method: "PATCH",
        body: JSON.stringify({ role: "superuser" }),
      },
      db,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "role must be admin or member",
    });
  });

  it("reports that first-run setup is still needed", async () => {
    const db = createDbStub((sql) => {
      if (sql.startsWith("INSERT INTO app_installation")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("FROM app_installation")) {
        return {
          first: async () => ({
            id: 1,
            status: "pending",
            owner_user_id: null,
            owner_email: null,
            completed_at: null,
            created_at: "2026-05-10T12:00:00.000Z",
            updated_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker("/api/setup/status", undefined, db, {
      OWNER_EMAIL: "owner@example.com",
      SETUP_SECRET: "setup-secret",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      needsSetup: true,
      setupLocked: false,
      isConfigured: true,
      status: "pending",
      ownerEmail: null,
    });
  });

  it("creates the initial owner through the one-time setup flow", async () => {
    const db = createDbStub((sql) => {
      if (sql.startsWith("INSERT INTO app_installation")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (
        sql.startsWith("UPDATE app_installation") &&
        sql.includes("status = 'in_progress'")
      ) {
        return {
          run: async () => ({
            results: [],
            meta: { changes: 1 },
          }),
        };
      }

      if (
        sql.startsWith("UPDATE app_installation") &&
        sql.includes("status = 'complete'")
      ) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("FROM app_installation")) {
        return {
          first: async () => ({
            id: 1,
            status: "pending",
            owner_user_id: null,
            owner_email: null,
            completed_at: null,
            created_at: "2026-05-10T12:00:00.000Z",
            updated_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/setup/complete",
      {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          name: "Owner Person",
          password: "super-secure-password",
          setupSecret: "setup-secret",
        }),
      },
      db,
      {
        OWNER_EMAIL: "owner@example.com",
        SETUP_SECRET: "setup-secret",
      },
    );

    expect(response.status).toBe(201);
    expect(authApiState.createUserCalls).toHaveLength(1);
    expect(authApiState.createUserCalls[0]).toMatchObject({
      body: {
        email: "owner@example.com",
        name: "Owner Person",
        password: "super-secure-password",
        role: "admin",
      },
    });
    expect(authApiState.signInEmailCalls).toHaveLength(1);
    expect(authApiState.signInEmailCalls[0]).toMatchObject({
      body: {
        email: "owner@example.com",
        password: "super-secure-password",
      },
    });

    const payload = (await response.json()) as {
      member: { email: string; role: string };
      session: { session: { userId: string } };
    };

    expect(payload.member).toEqual({
      id: "created-user-1",
      email: "new@example.com",
      name: "New Person",
      role: "admin",
    });
    expect(payload.session.session.userId).toBe("created-user-1");
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token",
    );
  });

  it("rejects setup when the secret is wrong", async () => {
    const db = createDbStub((sql) => {
      if (sql.startsWith("INSERT INTO app_installation")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("FROM app_installation")) {
        return {
          first: async () => ({
            id: 1,
            status: "pending",
            owner_user_id: null,
            owner_email: null,
            completed_at: null,
            created_at: "2026-05-10T12:00:00.000Z",
            updated_at: "2026-05-10T12:00:00.000Z",
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/setup/complete",
      {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          name: "Owner Person",
          password: "super-secure-password",
          setupSecret: "wrong-secret",
        }),
      },
      db,
      {
        OWNER_EMAIL: "owner@example.com",
        SETUP_SECRET: "setup-secret",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid setup secret",
    });
  });

  it("keeps setup closed after completion", async () => {
    const db = createDbStub((sql) => {
      if (sql.startsWith("INSERT INTO app_installation")) {
        return {
          run: async () => ({ results: [] }),
        };
      }

      if (sql.includes("FROM app_installation")) {
        return {
          first: async () => ({
            id: 1,
            status: "complete",
            owner_user_id: "owner-1",
            owner_email: "owner@example.com",
            completed_at: "2026-05-10T12:30:00.000Z",
            created_at: "2026-05-10T12:00:00.000Z",
            updated_at: "2026-05-10T12:30:00.000Z",
          }),
        };
      }

      if (
        sql.startsWith("UPDATE app_installation") &&
        sql.includes("status = 'in_progress'")
      ) {
        return {
          run: async () => ({
            results: [],
            meta: { changes: 0 },
          }),
        };
      }

      return {};
    });

    const response = await invokeWorker(
      "/api/setup/complete",
      {
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          name: "Owner Person",
          password: "super-secure-password",
          setupSecret: "setup-secret",
        }),
      },
      db,
      {
        OWNER_EMAIL: "owner@example.com",
        SETUP_SECRET: "setup-secret",
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Setup has already been completed",
    });
  });
});
