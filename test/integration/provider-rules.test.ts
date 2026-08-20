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
});
