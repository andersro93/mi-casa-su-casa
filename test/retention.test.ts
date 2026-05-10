import { describe, expect, it, vi } from "vitest";

import { purgeExpiredMessages } from "../src/server/jobs/retention";

describe("purgeExpiredMessages", () => {
  it("purges expired inbox and quarantine messages", async () => {
    const batch = vi.fn(async () => []);
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({})) }));

    const env = {
      DB: {
        batch,
        prepare,
      },
    } as unknown as Env;

    const executionContext = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;

    await purgeExpiredMessages(
      {
        env,
        executionContext,
      },
      Date.parse("2026-05-10T12:00:00Z"),
    );

    expect(batch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
