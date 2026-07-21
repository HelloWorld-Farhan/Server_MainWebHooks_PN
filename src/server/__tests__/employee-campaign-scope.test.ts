import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { campaignAccessService } from "@/server/services/campaign-access.service";
import type { TenantContext } from "@/server/types/context";

function ctx(partial: Partial<TenantContext>): TenantContext {
  return {
    authType: "user",
    userId: "u1",
    clerkUserId: "clerk1",
    companyId: "c1",
    membershipId: "m1",
    role: "SALES",
    permissions: [],
    campaignAccess: { type: "SELECTED", campaignIds: ["branch-a"] },
    loaders: {} as TenantContext["loaders"],
    ...partial,
  } as TenantContext;
}

describe("employee campaign scope", () => {
  it("filters employees to overlapping campaigns", () => {
    const salesCtx = ctx({ role: "SALES" });
    const filter = campaignAccessService.employeeScopeFilter(salesCtx);
    assert.ok(filter.OR);
  });

  it("owner bypasses employee scope filter", () => {
    const ownerCtx = ctx({
      role: "OWNER",
      campaignAccess: { type: "SELECTED", campaignIds: [] },
    });
    const filter = campaignAccessService.employeeScopeFilter(ownerCtx);
    assert.deepEqual(filter, {});
  });
});
