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
import { branchesService } from "@/server/services/branches.service";
import type { TenantContext } from "@/server/types/context";

function createMockCtx(companyId: string, userId: string): TenantContext {
  return {
    userId,
    clerkUserId: "user_test_clerk_id_123",
    companyId,
    membershipId: "member-" + userId,
    role: "OWNER",
    permissions: ["branches:read", "branches:write", "branches:bulk"],
    branchAccess: { type: "ALL", branchIds: [] },
    loaders: {} as any,
  };
}

describe("Branch Invitation Flow", () => {
  let companyId: string;
  let userId: string;
  let ctx: TenantContext;
  let createdBranchId: string;

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
        name: "Test Branch Inv Company",
        slug: "test-branch-inv-company-" + Math.random().toString(36).slice(2, 8),
        contractId: "TX" + Math.random().toString(36).substring(2, 10).toUpperCase(),
        clerkOrganizationId: "org_mock_company",
        ownerUserId: user.clerkUserId,
      },
    });
    companyId = company.id;

    await prisma.companyMember.create({
      data: {
        companyId,
        userId,
        role: "OWNER",
        status: "ACTIVE",
        branchAccessType: "ALL",
        joinedAt: new Date(),
      },
    });

    ctx = createMockCtx(companyId, userId);
  });

  after(async () => {
    // Cleanup
    if (companyId) {
      // Cascade delete handles branch invitations
      await prisma.company.delete({ where: { id: companyId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it("automatically creates a pending invitation when branch is created with an email", async () => {
    const branchEmail = "invited-admin-" + Math.random().toString(36).slice(2, 8) + "@test.com";
    const branch = await branchesService.create(ctx, {
      name: "Downtown branch for tests",
      email: branchEmail,
      status: "ACTIVE",
    });
    createdBranchId = branch.id;

    assert.equal(branch.name, "Downtown branch for tests");
    assert.equal(branch.email, branchEmail);

    // Verify invitation exists
    const invitation = await prisma.branchInvitation.findUnique({
      where: { branchId: branch.id },
    });
    assert.ok(invitation);
    assert.equal(invitation.email, branchEmail);
    assert.equal(invitation.status, "PENDING");
    assert.ok(invitation.token);
    assert.equal(invitation.clerkInvitationId, "clerk_inv_mock_123");
    assert.equal(invitation.clerkOrganizationId, "org_mock_company");
  });

  it("can cancel an invitation", async () => {
    assert.ok(createdBranchId);
    const updatedBranch = await branchesService.cancelInvitation(ctx, createdBranchId);
    assert.ok(updatedBranch.invitation);
    assert.equal(updatedBranch.invitation.status, "CANCELLED");

    const invitation = await prisma.branchInvitation.findUnique({
      where: { branchId: createdBranchId },
    });
    assert.equal(invitation?.status, "CANCELLED");
  });

  it("can generate a new invitation, invalidating the old one", async () => {
    assert.ok(createdBranchId);
    
    const oldInvitation = await prisma.branchInvitation.findUnique({
      where: { branchId: createdBranchId },
    });
    const oldToken = oldInvitation?.token;

    const updatedBranch = await branchesService.generateNewInvitation(ctx, createdBranchId);
    assert.ok(updatedBranch.invitation);
    assert.equal(updatedBranch.invitation.status, "PENDING");
    assert.notEqual(updatedBranch.invitation.token, oldToken);

    // Verify old token is no longer in active use (it's overwritten)
    const checkedOld = await prisma.branchInvitation.findFirst({
      where: { token: oldToken },
    });
    assert.equal(checkedOld, null);
  });
});
