import type { CampaignAccessType, CallVolumeRange, Company, PrimaryUseCase, User, UserRole } from "@prisma/client";
import { clerkClient } from "@/auth/clerk";

import { getUserMetadata } from "@/lib/user-metadata";
import {
  isClerkOrganizationsDisabled,
} from "@/server/lib/clerk-errors";
import { isClerkWebhooksEnabled } from "@/server/lib/clerk-config";
import { companySlugFromName, mapClerkRoleToUserRole } from "@/server/lib/clerk-sync";
import { prisma } from "@/server/lib/prisma";
import { TenantRepository } from "@/server/repositories/tenant.repository";
import { cacheService } from "@/server/cache/cache.service";
import {
  clerkMembershipService,
  type ClerkMembershipSnapshot,
} from "@/server/services/clerk-membership.service";
import {
  logResolutionEvent,
  recordReconciliationDuration,
} from "@/server/lib/resolution-metrics";

const tenantRepo = new TenantRepository(prisma);
const pendingReconciles = new Map<string, Promise<void>>();

function reconcileKey(clerkUserId: string, orgId?: string | null) {
  return `${clerkUserId}:${orgId ?? ""}`;
}

type ClerkUserSnapshot = {
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
  emailAddresses: { id: string; emailAddress: string }[];
  primaryEmailAddressId: string | null;
  phoneNumbers: { phoneNumber: string }[];
};

async function ensureCreditBalance(companyId: string) {
  await prisma.creditBalance.upsert({
    where: { companyId },
    create: {
      companyId,
      creditsRemaining: 0,
      creditsUsed: 0,
    },
    update: {},
  });
}

function getPrimaryEmail(clerkUser: ClerkUserSnapshot): string | null {
  return (
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? null
  );
}

async function upsertDbUserFromClerk(
  clerkUserId: string,
  clerkUser: ClerkUserSnapshot,
  phone?: string,
) {
  const primaryEmail = getPrimaryEmail(clerkUser);
  if (!primaryEmail) {
    throw new Error("User email is required");
  }

  return tenantRepo.upsertUser({
    clerkUserId,
    email: primaryEmail,
    firstName: clerkUser.firstName,
    lastName: clerkUser.lastName,
    imageUrl: clerkUser.imageUrl,
    phone: phone?.trim() || clerkUser.phoneNumbers[0]?.phoneNumber,
  });
}

function isPendingClerkUserId(clerkUserId: string) {
  return clerkUserId.startsWith("pending:");
}

async function mergePendingUserWithClerkId(
  clerkUserId: string,
  clerkUser: ClerkUserSnapshot,
  phone?: string,
) {
  const primaryEmail = getPrimaryEmail(clerkUser);
  if (!primaryEmail) {
    return null;
  }

  const pendingUser = await tenantRepo.findUserByEmail(primaryEmail);
  if (!pendingUser || !isPendingClerkUserId(pendingUser.clerkUserId)) {
    return null;
  }

  return prisma.user.update({
    where: { id: pendingUser.id },
    data: {
      clerkUserId,
      status: "ACTIVE",
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      imageUrl: clerkUser.imageUrl,
      phone: phone?.trim() || clerkUser.phoneNumbers[0]?.phoneNumber,
    },
  });
}

/**
 * Resolves a DB user by Clerk ID, merging pending invite placeholders by email when needed.
 */
export async function resolveOrMergeUserFromClerk(
  clerkUserId: string,
  phone?: string,
) {
  const existing = await tenantRepo.findUserByClerkId(clerkUserId);
  if (existing) {
    return existing;
  }

  const client = clerkClient;
  let clerkUser: ClerkUserSnapshot;
  try {
    clerkUser = await client.users.getUser(clerkUserId);
  } catch {
    return null;
  }

  const merged = await mergePendingUserWithClerkId(clerkUserId, clerkUser, phone);
  if (merged) {
    return merged;
  }

  try {
    return await upsertDbUserFromClerk(clerkUserId, clerkUser, phone);
  } catch {
    const primaryEmail = getPrimaryEmail(clerkUser);
    if (!primaryEmail) {
      return null;
    }

    const byEmail = await tenantRepo.findUserByEmail(primaryEmail);
    if (!byEmail) {
      return null;
    }

    return prisma.user.update({
      where: { id: byEmail.id },
      data: {
        clerkUserId,
        status: "ACTIVE",
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        imageUrl: clerkUser.imageUrl,
        phone: phone?.trim() || clerkUser.phoneNumbers[0]?.phoneNumber,
      },
    });
  }
}

async function ensureCompanyForClerkOrg(
  clerkOrganizationId: string,
  data: {
    name: string;
    slug: string;
    primaryUseCase?: PrimaryUseCase | null;
    callVolume?: CallVolumeRange | null;
  },
) {
  return tenantRepo.upsertCompany({
    clerkOrganizationId,
    name: data.name,
    slug: data.slug,
    primaryUseCase: data.primaryUseCase,
    callVolume: data.callVolume,
  });
}

async function linkUserToCompany(
  dbUser: User,
  company: Company,
  role: UserRole = "OWNER",
) {
  await tenantRepo.upsertMembership({
    companyId: company.id,
    userId: dbUser.id,
    role,
  });
  await ensureCreditBalance(company.id);
}

async function getActiveCompanyForUser(userId: string) {
  const membership = await prisma.companyMember.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { company: true },
    orderBy: { joinedAt: "desc" },
  });
  return membership?.company ?? null;
}

async function provisionFromClerkOrgMembership(
  dbUser: User,
  membership: {
    role: string;
    organization: { id: string; name: string };
  },
  metadata?: {
    primaryUseCase?: PrimaryUseCase | null;
    callVolume?: CallVolumeRange | null;
  },
): Promise<Company> {
  const org = membership.organization;

  const company = await ensureCompanyForClerkOrg(org.id, {
    name: org.name,
    slug: companySlugFromName(org.name),
    primaryUseCase: metadata?.primaryUseCase,
    callVolume: metadata?.callVolume,
  });

  const role: UserRole =
    membership.role === "org:admin"
      ? "OWNER"
      : mapClerkRoleToUserRole(membership.role);

  await linkUserToCompany(dbUser, company, role);
  return company;
}

async function getClerkOrgMemberships(clerkUserId: string) {
  return clerkMembershipService.getUserMemberships(clerkUserId);
}

async function getClerkMembershipInOrg(
  clerkUserId: string,
  clerkOrganizationId: string,
): Promise<ClerkMembershipSnapshot | null> {
  return clerkMembershipService.getMembershipInOrg(
    clerkUserId,
    clerkOrganizationId,
  );
}

/**
 * Repairs MongoDB tenant records when Clerk auth exists but company/membership
 * were never provisioned (e.g. contract link completed before DB was available).
 */
export async function syncTenantFromClerk(clerkUserId: string) {
  const client = clerkClient;
  let clerkUser;
  try {
    clerkUser = await client.users.getUser(clerkUserId);
  } catch {
    return null;
  }

  const metadata = getUserMetadata(
    clerkUser.unsafeMetadata as Record<string, unknown>,
  );

  let dbUser;
  try {
    dbUser = await resolveOrMergeUserFromClerk(clerkUserId, metadata.phone);
  } catch {
    return null;
  }
  if (!dbUser) {
    return null;
  }

  const existingCompany = await getActiveCompanyForUser(dbUser.id);
  if (existingCompany) {
    return existingCompany;
  }

  const orgMemberships = await getClerkOrgMemberships(clerkUserId);

  if (orgMemberships.data.length > 0) {
    return provisionFromClerkOrgMembership(dbUser, orgMemberships.data[0], {
      primaryUseCase: metadata.primaryUseCase,
      callVolume: metadata.callVolume,
    });
  }

  return null;
}

async function applyBranchAccessFromInvitation(
  memberId: string,
  campaignAccessType: CampaignAccessType,
  campaignIds: string[],
) {
  await prisma.memberCampaignAccess.deleteMany({ where: { memberId } });
  if (campaignAccessType === "SELECTED" && campaignIds.length > 0) {
    await prisma.memberCampaignAccess.createMany({
      data: campaignIds.map((campaignId) => ({ memberId, campaignId })),
    });
  }
}

export type ActivateMembershipMetadata = {
  propnexRole?: UserRole;
  campaignAccessType?: CampaignAccessType;
  campaignIds?: string[];
  jobTitle?: string | null;
  inviteName?: string;
};

async function resolveCompanyForClerkOrgActivation(
  clerkOrganizationId: string,
  userEmail: string,
  userId: string,
) {
  const byOrgId = await tenantRepo.findCompanyByClerkOrgId(clerkOrganizationId);
  if (byOrgId) {
    return byOrgId;
  }

  const invitation = await prisma.invitation.findFirst({
    where: {
      clerkOrganizationId,
      email: { equals: userEmail, mode: "insensitive" },
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (invitation) {
    const fromInvite = await prisma.company.findUnique({
      where: { id: invitation.companyId },
    });
    if (fromInvite) {
      return fromInvite;
    }
  }

  const campaignInvitation = await prisma.campaignInvitation.findFirst({
    where: {
      clerkOrganizationId,
      email: { equals: userEmail, mode: "insensitive" },
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (campaignInvitation) {
    const fromBranchInvite = await prisma.company.findUnique({
      where: { id: campaignInvitation.companyId },
    });
    if (fromBranchInvite) {
      return fromBranchInvite;
    }
  }

  const invitedMembership = await prisma.companyMember.findFirst({
    where: { userId, status: "INVITED" },
    include: { company: true },
    orderBy: { invitedAt: "desc" },
  });
  return invitedMembership?.company ?? null;
}

export async function activateMembershipFromClerkOrg(
  clerkOrganizationId: string,
  clerkUserId: string,
  role: UserRole,
  metadata?: ActivateMembershipMetadata,
  targetCompanyId?: string,
) {
  const user = await resolveOrMergeUserFromClerk(clerkUserId);
  if (!user) {
    return;
  }

  let company = targetCompanyId
    ? await prisma.company.findUnique({ where: { id: targetCompanyId } })
    : null;

  if (!company) {
    company = await resolveCompanyForClerkOrgActivation(
      clerkOrganizationId,
      user.email,
      user.id,
    );
  }
  if (!company) {
    return;
  }

  if (company.clerkOrganizationId !== clerkOrganizationId) {
    company = await prisma.company.update({
      where: { id: company.id },
      data: { clerkOrganizationId },
    });
  }

  const resolvedRole = metadata?.propnexRole ?? role;
  let campaignAccessType = metadata?.campaignAccessType ?? "ALL";
  let campaignIds = metadata?.campaignIds ?? [];
  let finalRole = resolvedRole;

  if (!metadata?.propnexRole || !metadata?.campaignAccessType) {
    const pendingInvite = await prisma.invitation.findFirst({
      where: {
        companyId: company.id,
        email: { equals: user.email, mode: "insensitive" },
        status: { in: ["PENDING", "ACCEPTED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (pendingInvite) {
      if (!metadata?.propnexRole) {
        finalRole = pendingInvite.role;
      }
      if (!metadata?.campaignAccessType) {
        campaignAccessType = pendingInvite.campaignAccessType;
        campaignIds = pendingInvite.campaignIds;
      }
    } else {
      const pendingCampaignInvite = await prisma.campaignInvitation.findFirst({
        where: {
          companyId: company.id,
          email: { equals: user.email, mode: "insensitive" },
          status: { in: ["PENDING", "ACCEPTED"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (pendingCampaignInvite) {
        if (!metadata?.propnexRole) {
          finalRole = "ADMIN";
        }
        if (!metadata?.campaignAccessType) {
          campaignAccessType = "SELECTED";
          campaignIds = [pendingCampaignInvite.campaignId];
        }
      }
    }
  }

  const existingMembership = await prisma.companyMember.findFirst({
    where: { companyId: company.id, userId: user.id },
  });
  const wasAlreadyActive = existingMembership?.status === "ACTIVE";

  let membership;
  if (existingMembership) {
    membership = await prisma.companyMember.update({
      where: { id: existingMembership.id },
      data: {
        role: finalRole,
        status: "ACTIVE",
        jobTitle: metadata?.jobTitle ?? undefined,
        campaignAccessType,
        joinedAt: new Date(),
      },
    });
  } else {
    membership = await prisma.companyMember.create({
      data: {
        companyId: company.id,
        userId: user.id,
        role: finalRole,
        status: "ACTIVE",
        jobTitle: metadata?.jobTitle ?? null,
        campaignAccessType,
        joinedAt: new Date(),
      },
    });
  }

  await applyBranchAccessFromInvitation(
    membership.id,
    campaignAccessType,
    campaignIds,
  );

  await prisma.invitation.updateMany({
    where: {
      companyId: company.id,
      email: { equals: user.email, mode: "insensitive" },
      status: "PENDING",
    },
    data: { status: "ACCEPTED" },
  });

  await prisma.campaignInvitation.updateMany({
    where: {
      companyId: company.id,
      email: { equals: user.email, mode: "insensitive" },
      status: "PENDING",
    },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
    },
  });

  if (isPendingClerkUserId(user.clerkUserId)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { clerkUserId, status: "ACTIVE" },
    });
  }

  await ensureCreditBalance(company.id);

  if (!wasAlreadyActive) {
    await cacheService.invalidateClerkMembershipCaches(
      clerkUserId,
      clerkOrganizationId,
    );
  }
}

async function ensureMembershipFromWebhook(
  clerkOrganizationId: string,
  clerkUserId: string,
  role: UserRole,
  metadata?: ActivateMembershipMetadata,
) {
  await activateMembershipFromClerkOrg(
    clerkOrganizationId,
    clerkUserId,
    role,
    metadata,
  );
}

async function tryActivateInvitedMembershipFromInvitation(
  companyId: string,
  clerkUserId: string,
  user: User,
  orgId?: string | null,
): Promise<boolean> {
  if (!clerkUserId.startsWith("user_")) {
    return false;
  }

  const invitedMembership = await prisma.companyMember.findFirst({
    where: { companyId, userId: user.id, status: "INVITED" },
  });
  if (!invitedMembership) {
    return false;
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const invitation = await prisma.invitation.findFirst({
    where: {
      companyId,
      email: { equals: user.email, mode: "insensitive" },
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!invitation) {
    return false;
  }

  const clerkOrganizationId =
    orgId ??
    invitation.clerkOrganizationId ??
    company?.clerkOrganizationId;
  if (!clerkOrganizationId?.startsWith("org_")) {
    return false;
  }

  await activateMembershipFromClerkOrg(
    clerkOrganizationId,
    clerkUserId,
    invitation.role,
    {
      propnexRole: invitation.role,
      campaignAccessType: invitation.campaignAccessType,
      campaignIds: invitation.campaignIds,
      jobTitle: invitation.jobTitle,
    },
    companyId,
  );

  const activated = await prisma.companyMember.findFirst({
    where: { companyId, userId: user.id, status: "ACTIVE" },
  });
  return Boolean(activated);
}

async function activateInvitedMembershipForCompany(
  companyId: string,
  clerkUserId: string,
  user: User,
  orgId?: string | null,
): Promise<boolean> {
  const activeMembership = await prisma.companyMember.findFirst({
    where: { companyId, userId: user.id, status: "ACTIVE" },
  });
  if (activeMembership) {
    return true;
  }

  const invitedMembership = await prisma.companyMember.findFirst({
    where: { companyId, userId: user.id, status: "INVITED" },
  });
  if (!invitedMembership) {
    return false;
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const invitation = await prisma.invitation.findFirst({
    where: {
      companyId,
      email: { equals: user.email, mode: "insensitive" },
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const clerkOrgIds = [
    orgId,
    company?.clerkOrganizationId,
    invitation?.clerkOrganizationId,
  ].filter((id): id is string => Boolean(id?.startsWith("org_")));
  const uniqueClerkOrgIds = [...new Set(clerkOrgIds)];

  for (const clerkOrganizationId of uniqueClerkOrgIds) {
    const clerkMembership = await getClerkMembershipInOrg(
      clerkUserId,
      clerkOrganizationId,
    );
    if (!clerkMembership) {
      continue;
    }

    const role = mapClerkRoleToUserRole(clerkMembership.role);
    const publicMetadata = (clerkMembership.publicMetadata ??
      {}) as ActivateMembershipMetadata;

    await activateMembershipFromClerkOrg(
      clerkOrganizationId,
      clerkUserId,
      role,
      publicMetadata,
      companyId,
    );

    const activated = await prisma.companyMember.findFirst({
      where: { companyId, userId: user.id, status: "ACTIVE" },
    });
    if (activated) {
      return true;
    }
  }

  return tryActivateInvitedMembershipFromInvitation(
    companyId,
    clerkUserId,
    user,
    orgId,
  );
}

/**
 * Reconciles CampaignInvitation rows that are still PENDING for a user who has
 * already become an active member via the campaign acceptance page.
 *
 * This handles the case where:
 * - The user accepted via /invitations/campaign/{token} (which sets CompanyMember
 *   to ACTIVE directly), but the campaignInvitation.updateMany inside
 *   activateMembershipFromClerkOrg was never reached because there was no
 *   INVITED CompanyMember row to trigger the reconciliation path.
 * - Webhooks are disabled, so the organizationMembership.created event never
 *   fired activateMembershipFromClerkOrg.
 */
async function reconcilePendingCampaignInvitations(
  user: User,
  clerkUserId: string,
  orgId?: string | null,
): Promise<void> {
  const pendingCampaignInvitations = await prisma.campaignInvitation.findMany({
    where: {
      email: { equals: user.email, mode: "insensitive" },
      status: "PENDING",
    },
    select: { id: true, companyId: true, clerkOrganizationId: true },
  });

  if (pendingCampaignInvitations.length === 0) {
    return;
  }

  for (const campaignInvite of pendingCampaignInvitations) {
    // Only mark ACCEPTED if the user is already an active member of this company.
    // This prevents accepting invitations for companies they haven't joined yet.
    const activeMembership = await prisma.companyMember.findFirst({
      where: { companyId: campaignInvite.companyId, userId: user.id, status: "ACTIVE" },
    });
    if (!activeMembership) {
      continue;
    }

    await prisma.campaignInvitation.update({
      where: { id: campaignInvite.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
      },
    });

    logResolutionEvent("clerk:reconcile:campaign-invitation-accepted", {
      clerkUserId,
      orgId,
      campaignInvitationId: campaignInvite.id,
      companyId: campaignInvite.companyId,
    });
  }
}

async function reconcileInviteMembershipOnLoginInner(
  clerkUserId: string,
  orgId?: string | null,
): Promise<void> {
  const start = performance.now();
  const user = await resolveOrMergeUserFromClerk(clerkUserId);
  if (!user) {
    return;
  }

  const invitedMembership = await prisma.companyMember.findFirst({
    where: { userId: user.id, status: "INVITED" },
  });
  const pendingCampaignInvite = await prisma.campaignInvitation.findFirst({
    where: {
      email: { equals: user.email, mode: "insensitive" },
      status: "PENDING",
    },
  });
  if (!invitedMembership && !pendingCampaignInvite) {
    await reconcilePendingCampaignInvitations(user, clerkUserId, orgId);
    return;
  }

  const orgMemberships = await getClerkOrgMemberships(clerkUserId);
  if (orgMemberships.data.length === 0) {
    const invitedMemberships = await prisma.companyMember.findMany({
      where: { userId: user.id, status: "INVITED" },
      select: { companyId: true },
    });
    for (const invited of invitedMemberships) {
      await activateInvitedMembershipForCompany(
        invited.companyId,
        clerkUserId,
        user,
        orgId,
      );
    }
    const pendingCampaignInvites = await prisma.campaignInvitation.findMany({
      where: {
        email: { equals: user.email, mode: "insensitive" },
        status: "PENDING",
      },
      select: { companyId: true },
    });
    for (const campaignInv of pendingCampaignInvites) {
      await activateInvitedMembershipForCompany(
        campaignInv.companyId,
        clerkUserId,
        user,
        orgId,
      );
    }
    recordReconciliationDuration(Math.round(performance.now() - start));
    logResolutionEvent("clerk:reconcile:fallback", {
      clerkUserId,
      orgId,
      invitedCount: invitedMemberships.length + pendingCampaignInvites.length,
    });
    return;
  }

  const ordered = orgId
    ? [
        ...orgMemberships.data.filter(
          (membership) => membership.organization.id === orgId,
        ),
        ...orgMemberships.data.filter(
          (membership) => membership.organization.id !== orgId,
        ),
      ]
    : orgMemberships.data;

  for (const clerkMembership of ordered) {
    const role = mapClerkRoleToUserRole(clerkMembership.role);
    const publicMetadata = (clerkMembership.publicMetadata ??
      {}) as ActivateMembershipMetadata;

    await activateMembershipFromClerkOrg(
      clerkMembership.organization.id,
      clerkUserId,
      role,
      publicMetadata,
    );
  }

  recordReconciliationDuration(Math.round(performance.now() - start));
  logResolutionEvent("clerk:reconcile:done", {
    clerkUserId,
    orgId,
    membershipCount: ordered.length,
  });
}

/**
 * Activates invited membership on login when webhooks are disabled or delayed.
 */
export async function reconcileInviteMembershipOnLogin(
  clerkUserId: string,
  orgId?: string | null,
) {
  const key = reconcileKey(clerkUserId, orgId);
  const pending = pendingReconciles.get(key);
  if (pending) {
    return pending;
  }

  const promise = reconcileInviteMembershipOnLoginInner(clerkUserId, orgId);
  pendingReconciles.set(key, promise);
  try {
    await promise;
  } finally {
    pendingReconciles.delete(key);
  }
}

/**
 * Ensures a user's membership for a specific company is ACTIVE, activating
 * invited rows when Clerk confirms org membership.
 */
export async function ensureActiveCompanyMembership(
  companyId: string,
  clerkUserId: string,
  orgId?: string | null,
) {
  const user = await resolveOrMergeUserFromClerk(clerkUserId);
  if (!user) {
    return;
  }

  const activeMembership = await prisma.companyMember.findFirst({
    where: { companyId, userId: user.id, status: "ACTIVE" },
  });
  if (activeMembership) {
    return;
  }

  await reconcileInviteMembershipOnLogin(clerkUserId, orgId);

  const activeAfterReconcile = await prisma.companyMember.findFirst({
    where: { companyId, userId: user.id, status: "ACTIVE" },
  });
  if (activeAfterReconcile) {
    return;
  }

  await activateInvitedMembershipForCompany(
    companyId,
    clerkUserId,
    user,
    orgId,
  );
}

export async function handleClerkWebhookEvent(
  type: string,
  data: Record<string, unknown>,
) {
  if (!isClerkWebhooksEnabled()) {
    return;
  }

  switch (type) {
    case "user.created":
    case "user.updated": {
      const clerkUserId = data.id as string;
      if (!clerkUserId) return;
      await resolveOrMergeUserFromClerk(clerkUserId);
      break;
    }

    case "organization.created":
    case "organization.updated": {
      const clerkOrganizationId = data.id as string;
      const name = (data.name as string) ?? "Company";
      if (!clerkOrganizationId) return;

      const existing =
        await tenantRepo.findCompanyByClerkOrgId(clerkOrganizationId);
      if (!existing) {
        return;
      }

      await tenantRepo.upsertCompany({
        clerkOrganizationId,
        name,
        slug: companySlugFromName(name),
      });
      break;
    }

    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const clerkOrganizationId = data.organization_id as string;
      const clerkUserId = data.public_user_data
        ? (data.public_user_data as { user_id: string }).user_id
        : (data.user_id as string);
      const role = mapClerkRoleToUserRole((data.role as string) ?? "org:member");
      const publicMetadata = (data.public_metadata ?? {}) as {
        propnexRole?: UserRole;
        campaignAccessType?: CampaignAccessType;
        campaignIds?: string[];
        jobTitle?: string | null;
        inviteName?: string;
      };

      if (!clerkOrganizationId || !clerkUserId) return;

      await ensureMembershipFromWebhook(
        clerkOrganizationId,
        clerkUserId,
        role,
        publicMetadata,
      );
      break;
    }

    case "organizationMembership.deleted": {
      const clerkOrganizationId = data.organization_id as string;
      const clerkUserId = data.public_user_data
        ? (data.public_user_data as { user_id: string }).user_id
        : (data.user_id as string);

      const company =
        await tenantRepo.findCompanyByClerkOrgId(clerkOrganizationId);
      const user = await tenantRepo.findUserByClerkId(clerkUserId);
      if (!company || !user) return;

      await prisma.companyMember.updateMany({
        where: { companyId: company.id, userId: user.id },
        data: { status: "REMOVED" },
      });

      await cacheService.invalidateClerkMembershipCaches(
        clerkUserId,
        clerkOrganizationId,
      );
      break;
    }

    case "session.created": {
      const clerkUserId = data.user_id as string;
      if (!clerkUserId) return;
      await prisma.user.updateMany({
        where: { clerkUserId },
        data: { lastLoginAt: new Date() },
      });
      break;
    }

    default:
      break;
  }
}
