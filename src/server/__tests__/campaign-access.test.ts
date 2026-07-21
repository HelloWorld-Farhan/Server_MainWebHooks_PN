import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { campaignAccessService } from "@/server/services/campaign-access.service";
import type { TenantContext } from "@/server/types/context";
import { ForbiddenError } from "@/server/lib/errors";

function ctx(partial: Partial<TenantContext>): TenantContext {
  return {
    authType: "user",
    userId: "user-1",
    clerkUserId: "clerk-1",
    companyId: "company-1",
    membershipId: "member-1",
    role: "SALES",
    permissions: [],
    campaignAccess: { type: "SELECTED", campaignIds: ["branch-a", "branch-b"] },
    loaders: {} as TenantContext["loaders"],
    ...partial,
  };
}

describe("branch access", () => {
  it("allows owner to access any branch", () => {
    const ownerCtx = ctx({ role: "OWNER", campaignAccess: { type: "SELECTED", campaignIds: [] } });
    assert.equal(campaignAccessService.hasAllCampaignAccess(ownerCtx), true);
    assert.doesNotThrow(() =>
      campaignAccessService.assertCampaignAccess(ownerCtx, "branch-x"),
    );
  });

  it("restricts selected campaign access", () => {
    const salesCtx = ctx({});
    assert.throws(
      () => campaignAccessService.assertCampaignAccess(salesCtx, "branch-x"),
      ForbiddenError,
    );
    assert.doesNotThrow(() =>
      campaignAccessService.assertCampaignAccess(salesCtx, "branch-a"),
    );
  });

  it("blocks null campaign records for selected access", () => {
    const salesCtx = ctx({});
    assert.throws(
      () => campaignAccessService.assertLeadCampaignAccess(salesCtx, null),
      ForbiddenError,
    );
  });

  it("scopes campaign list filter to allowed ids", () => {
    const salesCtx = ctx({});
    assert.deepEqual(campaignAccessService.campaignIdScopeFilter(salesCtx), {
      id: { in: ["branch-a", "branch-b"] },
    });
  });
});
