import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { branchAccessService } from "@/server/services/branch-access.service";
import type { TenantContext } from "@/server/types/context";
import { ForbiddenError } from "@/server/lib/errors";

function ctx(partial: Partial<TenantContext>): TenantContext {
  return {
    userId: "user-1",
    clerkUserId: "clerk-1",
    companyId: "company-1",
    membershipId: "member-1",
    role: "SALES",
    permissions: [],
    branchAccess: { type: "SELECTED", branchIds: ["branch-a", "branch-b"] },
    loaders: {} as TenantContext["loaders"],
    ...partial,
  };
}

describe("branch access", () => {
  it("allows owner to access any branch", () => {
    const ownerCtx = ctx({ role: "OWNER", branchAccess: { type: "SELECTED", branchIds: [] } });
    assert.equal(branchAccessService.hasAllBranchAccess(ownerCtx), true);
    assert.doesNotThrow(() =>
      branchAccessService.assertBranchAccess(ownerCtx, "branch-x"),
    );
  });

  it("restricts selected branch access", () => {
    const salesCtx = ctx({});
    assert.throws(
      () => branchAccessService.assertBranchAccess(salesCtx, "branch-x"),
      ForbiddenError,
    );
    assert.doesNotThrow(() =>
      branchAccessService.assertBranchAccess(salesCtx, "branch-a"),
    );
  });

  it("blocks null branch records for selected access", () => {
    const salesCtx = ctx({});
    assert.throws(
      () => branchAccessService.assertLeadBranchAccess(salesCtx, null),
      ForbiddenError,
    );
  });

  it("scopes branch list filter to allowed ids", () => {
    const salesCtx = ctx({});
    assert.deepEqual(branchAccessService.branchIdScopeFilter(salesCtx), {
      id: { in: ["branch-a", "branch-b"] },
    });
  });
});
