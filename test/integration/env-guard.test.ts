import { createExecutionContext, env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../../src/index";

type WorkerRequest = Parameters<NonNullable<typeof worker.fetch>>[0];

function request(url: string): WorkerRequest {
  return new Request(url) as unknown as WorkerRequest;
}

function brokenEnv(): Env {
  return { ...(env as unknown as Env), AUTH_SECRET: "", APP_URL: "" };
}

describe("environment guard", () => {
  it("workerd exposes vars through process.env (Better Auth reads NODE_ENV from it)", () => {
    expect(process.env.APP_NAME).toBe("Mi Casa Su Casa (test)");
  });

  it("answers /api/health/ready with 200 when the environment is complete", async () => {
    const response = await SELF.fetch("http://localhost:8787/api/health/ready");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready" });
  });

  it("returns 503 from API routes and readiness when required config is missing, but stays live", async () => {
    const ctx = createExecutionContext();
    const ready = await worker.fetch?.(
      request("http://localhost:8787/api/health/ready"),
      brokenEnv(),
      ctx,
    );
    expect(ready?.status).toBe(503);
    expect(await ready?.json()).toMatchObject({
      error: "misconfigured",
      problems: expect.arrayContaining([
        expect.objectContaining({ key: "AUTH_SECRET" }),
        expect.objectContaining({ key: "APP_URL" }),
      ]),
    });

    const api = await worker.fetch?.(
      request("http://localhost:8787/api/setup/status"),
      brokenEnv(),
      ctx,
    );
    expect(api?.status).toBe(503);

    const live = await worker.fetch?.(
      request("http://localhost:8787/api/health/live"),
      brokenEnv(),
      ctx,
    );
    expect(live?.status).toBe(200);
  });

  it("refuses to run the scheduled job with a broken environment", async () => {
    await expect(
      worker.scheduled?.(
        {
          scheduledTime: Date.now(),
          cron: "0 3 * * *",
          noRetry() {},
        } as ScheduledController,
        brokenEnv(),
        createExecutionContext(),
      ),
    ).rejects.toThrow(/misconfigured|AUTH_SECRET/);
  });
});
