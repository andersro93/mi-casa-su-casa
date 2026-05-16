import { describe, expect, it } from "vitest";

import {
  buildHouseholdApiPath,
  getProviderAccessToggleRequest,
} from "../src/client/utils";

describe("buildHouseholdApiPath", () => {
  it("builds inbox household routes under /api/inbox/:slug", () => {
    expect(buildHouseholdApiPath("home", "/inbox/providers")).toBe(
      "/api/inbox/home/providers",
    );
  });

  it("builds admin household routes under /api/admin/:slug", () => {
    expect(buildHouseholdApiPath("home", "/admin/members")).toBe(
      "/api/admin/home/members",
    );
  });

  it("keeps non-household APIs under /api/:slug for other scoped paths", () => {
    expect(buildHouseholdApiPath("home", "/settings")).toBe(
      "/api/home/settings",
    );
  });
});

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
