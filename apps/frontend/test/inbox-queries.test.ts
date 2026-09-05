import { describe, expect, it } from "vitest";

import {
  flattenMessages,
  INBOX_REFETCH_INTERVAL_MS,
  inboxKeys,
  providerMessagesOptions,
  providerSummariesOptions,
} from "../src/queries/inbox";
import { parseSender } from "../src/utils";

describe("inbox query options", () => {
  it("poll every 10 s so a code that just arrived shows up without a reload", () => {
    expect(INBOX_REFETCH_INTERVAL_MS).toBe(10_000);
    expect(providerSummariesOptions("olsen").refetchInterval).toBe(10_000);
    expect(providerMessagesOptions("olsen", "netflix").refetchInterval).toBe(
      10_000,
    );
  });

  it("scopes keys by household so switching households never shows stale data", () => {
    expect(providerSummariesOptions("olsen").queryKey).toEqual(
      inboxKeys.providers("olsen"),
    );
    expect(inboxKeys.messages("olsen", "netflix")).toEqual([
      "inbox",
      "olsen",
      "messages",
      "netflix",
    ]);
    // invalidating inboxKeys.all(slug) must match both
    expect(inboxKeys.providers("olsen").slice(0, 2)).toEqual(
      inboxKeys.all("olsen"),
    );
  });

  it("pages by the server's nextBefore cursor", () => {
    const options = providerMessagesOptions("olsen", "netflix");
    expect(options.initialPageParam).toBeNull();
    expect(
      options.getNextPageParam(
        {
          provider: { providerKey: "netflix", displayName: "Netflix" },
          messages: [],
          page: { limit: 50, nextBefore: "2026-01-01T00:00:00.000Z" },
        },
        [],
        null,
        [],
      ),
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(flattenMessages(undefined)).toEqual([]);
  });
});

describe("parseSender", () => {
  it("splits display name and address", () => {
    expect(parseSender("Netflix <info@account.netflix.com>")).toEqual({
      name: "Netflix",
      address: "info@account.netflix.com",
    });
    expect(parseSender('"Disney+" <no-reply@disneyplus.com>')).toEqual({
      name: "Disney+",
      address: "no-reply@disneyplus.com",
    });
    expect(parseSender("noreply@posten.no")).toEqual({
      name: "noreply@posten.no",
      address: "noreply@posten.no",
    });
    expect(parseSender(null)).toEqual({
      name: "Unknown sender",
      address: null,
    });
  });
});
