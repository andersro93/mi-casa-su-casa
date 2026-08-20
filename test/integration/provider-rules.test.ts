import {
  createProvider,
  createSenderRule,
  findProviderMatch,
} from "@server/db/repositories/provider-rules";
import { describe, expect, it } from "vitest";

import { db, insertHousehold } from "./helpers";

describe("provider rule matching (D1)", () => {
  it("prefers exact address rules over domain rules and is case-insensitive", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const netflix = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    const generic = await createProvider(
      db,
      household.id,
      "generic",
      "Generic",
    );

    await createSenderRule(
      db,
      household.id,
      generic.id,
      "domain",
      "netflix.com",
    );
    await createSenderRule(
      db,
      household.id,
      netflix.id,
      "exact",
      "info@netflix.com",
    );

    const exact = await findProviderMatch(db, household.id, "INFO@Netflix.com");
    expect(exact?.providerKey).toBe("netflix");

    const domain = await findProviderMatch(
      db,
      household.id,
      "other@netflix.com",
    );
    expect(domain?.providerKey).toBe("generic");
  });

  it("does not match look-alike domains and never crosses households", async () => {
    const casa = await insertHousehold({ slug: "casa" });
    const otra = await insertHousehold({ slug: "otra" });
    const provider = await createProvider(db, casa.id, "netflix", "Netflix");
    await createSenderRule(db, casa.id, provider.id, "domain", "netflix.com");

    expect(await findProviderMatch(db, casa.id, "x@notnetflix.com")).toBeNull();
    expect(await findProviderMatch(db, otra.id, "x@netflix.com")).toBeNull();
  });

  it("rejects duplicate rules within a household", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const provider = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    await createSenderRule(
      db,
      household.id,
      provider.id,
      "domain",
      "netflix.com",
    );

    const error = await createSenderRule(
      db,
      household.id,
      provider.id,
      "domain",
      "netflix.com",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(
      String((error as Error & { cause?: unknown }).cause ?? error),
    ).toMatch(/UNIQUE constraint failed/);
  });

  it("matches subdomains of a domain rule and prefers the most specific domain rule", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const netflix = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    const ses = await createProvider(db, household.id, "ses", "SES");
    await createSenderRule(
      db,
      household.id,
      netflix.id,
      "domain",
      "netflix.com",
    );
    await createSenderRule(
      db,
      household.id,
      ses.id,
      "domain",
      "em.netflix.com",
    );

    expect(
      (await findProviderMatch(db, household.id, "bounces@mail.netflix.com"))
        ?.providerKey,
    ).toBe("netflix");
    expect(
      (await findProviderMatch(db, household.id, "x@em.netflix.com"))
        ?.providerKey,
    ).toBe("ses");
    expect(
      await findProviderMatch(db, household.id, "x@notnetflix.com"),
    ).toBeNull();
  });

  it("tries the visible From address before the envelope sender and reports the source", async () => {
    const household = await insertHousehold({ slug: "casa" });
    const netflix = await createProvider(
      db,
      household.id,
      "netflix",
      "Netflix",
    );
    await createSenderRule(
      db,
      household.id,
      netflix.id,
      "domain",
      "netflix.com",
    );

    const match = await findProviderMatch(db, household.id, [
      { address: "info@netflix.com", source: "header" },
      { address: "bounce+123@amazonses.com", source: "envelope" },
    ]);
    expect(match).toMatchObject({
      providerKey: "netflix",
      matchedAddress: "info@netflix.com",
      matchedSource: "header",
      matchType: "domain",
    });

    const envelopeOnly = await findProviderMatch(db, household.id, [
      { address: "someone@else.example", source: "header" },
      { address: "codes@netflix.com", source: "envelope" },
    ]);
    expect(envelopeOnly).toMatchObject({ matchedSource: "envelope" });
  });
});
