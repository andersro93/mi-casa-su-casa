import { describe, expect, it } from "vitest";

import { getProviderAccessToggleRequest } from "../src/client/utils";

describe("getProviderAccessToggleRequest", () => {
  it("uses POST and a granted message when access should be enabled", () => {
    expect(getProviderAccessToggleRequest(true)).toEqual({
      method: "POST",
      statusMessage: "Provider access granted.",
    });
  });

  it("uses DELETE and a revoked message when access should be disabled", () => {
    expect(getProviderAccessToggleRequest(false)).toEqual({
      method: "DELETE",
      statusMessage: "Provider access revoked.",
    });
  });
});
