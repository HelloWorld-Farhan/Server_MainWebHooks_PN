import assert from "node:assert/strict";
import { describe, it, before, after, mock } from "node:test";

import { clerkOrgLib } from "@/lib/clerk/organization";

mock.method(clerkOrgLib, "getActiveClerkOrganizationId", () => {
  return Promise.resolve("org_mock_company");
});

mock.method(clerkOrgLib, "sendClerkOrganizationInvitation", () => {
  return Promise.resolve({
    invitationId: "clerk_inv_mock_123",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
});

mock.method(clerkOrgLib, "revokeClerkOrganizationInvitation", () => {
  return Promise.resolve();
});

mock.method(clerkOrgLib, "removeClerkOrganizationAccess", () => {
  return Promise.resolve();
});

import prisma from "@/server/lib/prisma";
import { campaignsService } from "@/server/services/campaigns.service";
import type { TenantContext } from "@/server/types/context";

function createMockCtx(companyId: string, userId: string): TenantContext {
  return {
    authType: "user",
    userId,
    clerkUserId: "user_test_clerk_id_123",
    companyId,
    membershipId: "member-" + userId,
    role: "OWNER",
    permissions: ["campaigns:read", "campaigns:write", "campaigns:bulk"],
    campaignAccess: { type: "ALL", campaignIds: [] },
    loaders: {} as any,
  };
}

describe("Campaign Invitation Flow", () => {
  let companyId: string;
  let userId: string;
  let ctx: TenantContext;
  let createdCampaignId: string;

  before(async () => {
    // Setup dummy company & user
    const user = await prisma.user.create({
      data: {
        clerkUserId: "user_" + Math.random().toString(36).slice(2, 8),
        email: "inv-test-" + Math.random().toString(36).slice(2, 8) + "@test.com",
        firstName: "Test",
        lastName: "User",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: "Test Campaign Inv Company",
        slug: "test-campaign-inv-company-" + Math.random().toString(36).slice(2, 8),
        contractId: "TX" + Math.random().toString(36).substring(2, 10).toUpperCase(),
        clerkOrganizationId: "org_mock_company",
        ownerUserId: user.clerkUserId,
        cli: "CLI" + Math.random().toString(36).slice(2, 8),
        companyCode: "CC" + Math.random().toString(36).slice(2, 8),
      },
    });
    companyId = company.id;

    await prisma.companyMember.create({
      data: {
        companyId,
        userId,
        role: "OWNER",
        status: "ACTIVE",
        campaignAccessType: "ALL",
        joinedAt: new Date(),
      },
    });

    ctx = createMockCtx(companyId, userId);
  });

  after(async () => {
    // Cleanup
    if (companyId) {
      // Cascade delete handles campaign invitations
      await prisma.company.delete({ where: { id: companyId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it("automatically creates a pending invitation when campaign is created with an email", async () => {
    const campaignEmail = "invited-admin-" + Math.random().toString(36).slice(2, 8) + "@test.com";
    const campaign = await campaignsService.create(ctx, {
      name: "Downtown campaign for tests",
      email: campaignEmail,
      status: "ACTIVE",
    });
    createdCampaignId = campaign.id;

    assert.equal(campaign.name, "Downtown campaign for tests");
    assert.equal(campaign.email, campaignEmail);

    // Verify invitation exists
    const invitation = await prisma.campaignInvitation.findUnique({
      where: { campaignId: campaign.id },
    });
    assert.ok(invitation);
    assert.equal(invitation.email, campaignEmail);
    assert.equal(invitation.status, "PENDING");
    assert.ok(invitation.token);
    assert.equal(invitation.clerkInvitationId, "clerk_inv_mock_123");
    assert.equal(invitation.clerkOrganizationId, "org_mock_company");
  });

  it("can cancel an invitation", async () => {
    assert.ok(createdCampaignId);
    const updatedCampaign = await campaignsService.cancelInvitation(ctx, createdCampaignId);
    assert.ok(updatedCampaign.invitation);
    assert.equal(updatedCampaign.invitation.status, "CANCELLED");

    const invitation = await prisma.campaignInvitation.findUnique({
      where: { campaignId: createdCampaignId },
    });
    assert.equal(invitation?.status, "CANCELLED");
  });

  it("can generate a new invitation, invalidating the old one", async () => {
    assert.ok(createdCampaignId);
    
    const oldInvitation = await prisma.campaignInvitation.findUnique({
      where: { campaignId: createdCampaignId },
    });
    const oldToken = oldInvitation?.token;

    const updatedCampaign = await campaignsService.generateNewInvitation(ctx, createdCampaignId);
    assert.ok(updatedCampaign.invitation);
    assert.equal(updatedCampaign.invitation.status, "PENDING");
    assert.notEqual(updatedCampaign.invitation.token, oldToken);

    // Verify old token is no longer in active use (it's overwritten)
    const checkedOld = await prisma.campaignInvitation.findFirst({
      where: { token: oldToken },
    });
    assert.equal(checkedOld, null);
  });
});
