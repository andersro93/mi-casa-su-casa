import { describe, expect, it } from "vitest";

import {
  createHouseholdSchema,
  invitationSchema,
  profileSchema,
  providerSchema,
  senderRuleSchema,
  setupSchema,
} from "../src/server/http/schemas";

describe("request schemas", () => {
  it("normalises and validates sender rules", () => {
    expect(
      senderRuleSchema.parse({
        providerId: "p1",
        matchType: "domain",
        matchValue: " @Netflix.COM ",
      }),
    ).toMatchObject({ matchValue: "netflix.com" });
    expect(
      senderRuleSchema.safeParse({
        providerId: "p1",
        matchType: "domain",
        matchValue: "not a domain",
      }).success,
    ).toBe(false);
    expect(
      senderRuleSchema.safeParse({
        providerId: "p1",
        matchType: "exact",
        matchValue: "netflix.com",
      }).success,
    ).toBe(false);
    expect(
      senderRuleSchema.parse({
        providerId: "p1",
        matchType: "exact",
        matchValue: "Info@Netflix.com",
      }),
    ).toMatchObject({ matchValue: "info@netflix.com" });
    expect(
      senderRuleSchema.safeParse({
        providerId: "p1",
        matchType: "regex",
        matchValue: "x",
      }).success,
    ).toBe(false);
  });

  it("enforces lengths, formats and legacy role mapping", () => {
    expect(
      providerSchema.safeParse({ providerKey: "Net flix", displayName: "x" })
        .success,
    ).toBe(false);
    expect(
      providerSchema.parse({
        providerKey: " NETFLIX ",
        displayName: " Netflix ",
      }),
    ).toEqual({
      providerKey: "netflix",
      displayName: "Netflix",
    });
    expect(
      providerSchema.safeParse({
        providerKey: "netflix",
        displayName: "x".repeat(81),
      }).success,
    ).toBe(false);

    expect(
      invitationSchema.parse({
        email: "Kid@Example.com",
        name: "Kid",
        role: "admin",
      }),
    ).toMatchObject({
      email: "kid@example.com",
      role: "owner",
      providerIds: [],
    });
    expect(
      invitationSchema.safeParse({ email: "nope", name: "Kid" }).success,
    ).toBe(false);
    expect(
      invitationSchema.safeParse({
        email: "a@b.co",
        name: "Kid",
        providerIds: Array(51).fill("p"),
      }).success,
    ).toBe(false);

    expect(
      createHouseholdSchema.safeParse({ slug: "settings", displayName: "x" })
        .success,
    ).toBe(false);
    expect(
      createHouseholdSchema.parse({ slug: " Casa ", displayName: "Casa" }),
    ).toEqual({
      slug: "casa",
      displayName: "Casa",
    });

    expect(profileSchema.parse({ name: "Me", image: "" })).toEqual({
      name: "Me",
      image: null,
    });
    expect(
      profileSchema.parse({ name: "Me", image: "https://x.y/a.png" }),
    ).toEqual({
      name: "Me",
      image: "https://x.y/a.png",
    });
    expect(
      profileSchema.safeParse({ name: "Me", image: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({
        name: "Me",
        image: `https://x.y/${"a".repeat(2100)}`,
      }).success,
    ).toBe(false);

    expect(
      setupSchema.safeParse({
        email: "owner@example.com",
        name: "Owner",
        password: "short",
        householdName: "Casa",
        householdSlug: "casa",
        setupSecret: "s",
      }).success,
    ).toBe(false);
  });
});
