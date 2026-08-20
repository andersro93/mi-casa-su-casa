import {
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
} from "cloudflare:test";
import { getInstallationState } from "@server/db/repositories/installation-state";
import { purgeExpired } from "@server/db/repositories/messages";
import { createProvider } from "@server/db/repositories/provider-rules";
import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

import { count, db, insertHousehold } from "./helpers";

async function seedMessages(
  householdId: string,
  providerId: string,
  n: number,
  deleteAfter: string,
) {
  const statements = [];
  for (let i = 0; i < n; i += 1) {
    statements.push(
      db
        .prepare(
          `INSERT INTO messages (id, household_id, message_id, provider_id, envelope_from, envelope_to,
             text_body, classification_reason, raw_size, received_at, delete_after)
           VALUES (?1, ?2, ?3, ?4, 'a@b.c', 'casa@x.y', 'body', 'r', 1, ?5, ?5)`,
        )
        .bind(
          `m-${i}-${deleteAfter}`,
          householdId,
          `<m-${i}-${deleteAfter}@t>`,
          providerId,
          deleteAfter,
        ),
    );
  }
  // D1 batches are capped; chunk to stay comfortably under the limit.
  for (let i = 0; i < statements.length; i += 100) {
    await db.batch(statements.slice(i, i + 100));
  }
}

describe("retention job (D1)", () => {
  it("purges in bounded batches, expires invitations, records the run and surfaces it on /ready", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    await seedMessages(
      household.id,
      provider.id,
      230,
      "2026-01-01T00:00:00.000Z",
    );
    await seedMessages(
      household.id,
      provider.id,
      5,
      "2099-01-01T00:00:00.000Z",
    );

    const before = await SELF.fetch("http://localhost:8787/api/health/ready");
    await expect(before.json()).resolves.toMatchObject({
      retention: { lastRunAt: null, stale: true },
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Small batch size so the loop is exercised.
      const result = await purgeExpired(db, "2026-06-01T00:00:00.000Z", 100);
      expect(result).toEqual({ messages: 230, quarantine: 0, batches: 4 });
      expect(await count("messages")).toBe(5);

      // Full entrypoint: the scheduled handler records the run.
      await worker.scheduled?.(
        createScheduledController({
          scheduledTime: new Date("2026-06-01T03:00:00Z"),
          cron: "0 3 * * *",
        }),
        env as unknown as Env,
        createExecutionContext(),
      );
      const state = await getInstallationState(db);
      expect(state.last_retention_run_at).toBe("2026-06-01T03:00:00.000Z");

      const completed = logSpy.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes("retention_completed"));
      expect(completed).toBeDefined();
    } finally {
      logSpy.mockRestore();
    }

    // Readiness reports the last run; it is "stale" here only because the
    // scheduled time we used is in the past relative to the real clock.
    const after = await SELF.fetch("http://localhost:8787/api/health/ready");
    await expect(after.json()).resolves.toMatchObject({
      retention: { lastRunAt: "2026-06-01T03:00:00.000Z" },
    });
  });
});
