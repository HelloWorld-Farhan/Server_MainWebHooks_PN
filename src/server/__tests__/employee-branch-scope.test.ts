import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { branchAccessService } from "@/server/services/branch-access.service";
import type { TenantContext } from "@/server/types/context";

function ctx(partial: Partial<TenantContext>): TenantContext {
  return {
    userId: "u1",
    clerkUserId: "clerk1",
    companyId: "c1",
    membershipId: "m1",
    role: "SALES",
    permissions: [],
    branchAccess: { type: "SELECTED", branchIds: ["branch-a"] },
    loaders: {} as TenantContext["loaders"],
    ...partial,
  } as TenantContext;
}

describe("employee branch scope", () => {
  it("filters employees to overlapping branches", () => {
    const salesCtx = ctx({ role: "SALES" });
    const filter = branchAccessService.employeeScopeFilter(salesCtx);
    assert.ok(filter.OR);
  });

  it("owner bypasses employee scope filter", () => {
    const ownerCtx = ctx({
      role: "OWNER",
      branchAccess: { type: "SELECTED", branchIds: [] },
    });
    const filter = branchAccessService.employeeScopeFilter(ownerCtx);
    assert.deepEqual(filter, {});
  });
});
