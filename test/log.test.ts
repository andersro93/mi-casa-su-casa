import { afterEach, describe, expect, it, vi } from "vitest";

import { logEvent } from "../src/server/runtime/log";

describe("logEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits one JSON line per call with event and level first", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logEvent("info", "thing_happened", { a: 1 });
    logEvent("warn", "thing_odd");
    logEvent("error", "thing_broke", { error: "boom" });

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: "thing_happened",
      level: "info",
      a: 1,
    });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: "thing_odd",
      level: "warn",
    });
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      event: "thing_broke",
      level: "error",
      error: "boom",
    });
  });
});
