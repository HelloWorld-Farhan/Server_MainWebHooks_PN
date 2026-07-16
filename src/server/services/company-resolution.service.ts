import type { Company, CompanyMember, User } from "@prisma/client";

import { cacheService } from "@/server/cache/cache.service";
import { CACHE_TTL } from "@/server/cache/keys";
import { gqlDebug, gqlLogError } from "@/server/graphql/debug";
import { isAppError } from "@/server/lib/errors";
import { isClerkWebhooksEnabled } from "@/server/lib/clerk-config";
import prisma from "@/server/lib/prisma";
import {
  incrementMetric,
  logResolutionEvent,
  recordCompanyResolutionDuration,
} from "@/server/lib/resolution-metrics";
import { TenantRepository } from "@/server/repositories/tenant.repository";
import {
  ensureActiveCompanyMembership,
  reconcileInviteMembershipOnLogin,
  syncTenantFromClerk,
} from "@/server/services/clerk-provision.service";
import { tenantService } from "@/server/services/tenant.service";

const tenantRepo = new TenantRepository(prisma);

type MembershipWithRelations = CompanyMember & {
  user: User;
  customRole?: { permissions: string[] } | null;
  branchAccess?: { branchId: string }[];
  company?: Company;
};

export type ResolvedTenant = {
  company: Company;
  user: User;
  membership: MembershipWithRelations;
};

export type ResolutionCache = {
  tenant?: ResolvedTenant | null;
};

async function findActiveMembership(
  userId: string,
  orgId?: string | null,
): Promise<MembershipWithRelations | null> {
  const memberships = await prisma.companyMember.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      customRole: true,
      user: true,
      company: true,
      branchAccess: true,
    },
    orderBy: { joinedAt: "desc" },
  });

  if (memberships.length === 0) {
    return null;
  }

  if (orgId) {
    const byOrg = memberships.find(
      (m) => m.company?.clerkOrganizationId === orgId,
    );
    if (byOrg) {
      return byOrg;
    }
  }

  return memberships[0];
}

async function findInvitedMembership(
  userId: string,
  orgId?: string | null,
): Promise<MembershipWithRelations | null> {
  const memberships = await prisma.companyMember.findMany({
    where: { userId, status: "INVITED" },
    include: {
      customRole: true,
      user: true,
      company: true,
      branchAccess: true,
    },
    orderBy: { invitedAt: "desc" },
  });

  if (memberships.length === 0) {
    return null;
  }

  if (orgId) {
    const byOrg = memberships.find(
      (m) => m.company?.clerkOrganizationId === orgId,
    );
    if (byOrg) {
      return byOrg;
    }
  }

  return memberships[0];
}

async function loadFromResolvedCache(
  clerkUserId: string,
): Promise<ResolvedTenant | null> {
  const cached = await cacheService.getResolvedCompany(clerkUserId);
  if (!cached) {
    incrementMetric("redis_company_miss");
    return null;
  }

  incrementMetric("redis_company_hit");
  gqlDebug("company:cache-hit", { clerkUserId, companyId: cached.companyId });

  const user = await tenantRepo.findUserByClerkId(clerkUserId);
  if (!user) {
    await cacheService.invalidateClerkMembershipCaches(clerkUserId);
    return null;
  }

  const membership = await tenantRepo.findMembership(
    cached.companyId,
    user.id,
  );

  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.id !== cached.membershipId
  ) {
    await cacheService.invalidateClerkMembershipCaches(clerkUserId);
    return null;
  }

  return {
    company: membership.company,
    user: membership.user,
    membership,
  };
}

async function cacheResolvedTenant(
  clerkUserId: string,
  tenant: ResolvedTenant,
): Promise<void> {
  await cacheService.setResolvedCompany(
    clerkUserId,
    {
      companyId: tenant.company.id,
      membershipId: tenant.membership.id,
      role: tenant.membership.role,
    },
    CACHE_TTL.RESOLVED_COMPANY,
  );
}

async function scheduleBackgroundReconciliation(
  clerkUserId: string,
  orgId?: string | null,
): Promise<void> {
  if (isClerkWebhooksEnabled()) {
    return;
  }

  const user = await tenantRepo.findUserByClerkId(clerkUserId);
  if (user) {
    const invitedMembership = await findInvitedMembership(user.id, orgId);
    const pendingBranchInvite = await prisma.branchInvitation.findFirst({
      where: {
        email: { equals: user.email, mode: "insensitive" },
        status: "PENDING",
      },
    });
    if (!invitedMembership && !pendingBranchInvite) {
      return;
    }
  }

  void reconcileInviteMembershipOnLogin(clerkUserId, orgId).catch((error) => {
    gqlLogError("company:background-reconcile:error", error, {
      clerkUserId,
      orgId,
    });
  });
}

async function resolveFromMongoDb(
  clerkUserId: string,
  orgId?: string | null,
): Promise<ResolvedTenant | null> {
  let user = await tenantRepo.findUserByClerkId(clerkUserId);

  if (orgId) {
    try {
      const company = await tenantService.resolveCompany(orgId);
      if (user) {
        const membership = await tenantRepo.findMembership(company.id, user.id);
        if (membership?.status === "ACTIVE") {
          return { company, user, membership };
        }
      }
    } catch (error) {
      if (!isAppError(error) || error.statusCode !== 404) {
        throw error;
      }
    }
  }

  if (!user) {
    user = await tenantService.ensureUserFromClerk(clerkUserId);
  }
  if (!user) {
    return null;
  }

  const activeMembership = await findActiveMembership(user.id, orgId);
  if (activeMembership?.company) {
    return {
      company: activeMembership.company,
      user,
      membership: activeMembership,
    };
  }

  return null;
}

async function recoverTenant(
  clerkUserId: string,
  orgId?: string | null,
  options?: { forceReconcile?: boolean },
): Promise<ResolvedTenant | null> {
  let user = await tenantRepo.findUserByClerkId(clerkUserId);
  if (!user) {
    user = await tenantService.ensureUserFromClerk(clerkUserId);
  }

  const invitedMembership = user
    ? await findInvitedMembership(user.id, orgId)
    : null;

  const pendingBranchInvite = user
    ? await prisma.branchInvitation.findFirst({
        where: {
          email: { equals: user.email, mode: "insensitive" },
          status: "PENDING",
        },
      })
    : null;

  if (options?.forceReconcile || invitedMembership || pendingBranchInvite) {
    await reconcileInviteMembershipOnLogin(clerkUserId, orgId);
  }

  if (user) {
    const activeAfterReconcile = await findActiveMembership(user.id, orgId);
    if (activeAfterReconcile?.company) {
      return {
        company: activeAfterReconcile.company,
        user,
        membership: activeAfterReconcile,
      };
    }
  }

  if (invitedMembership?.company) {
    await ensureActiveCompanyMembership(
      invitedMembership.company.id,
      clerkUserId,
      orgId,
    );
    const refreshed = user
      ? await findActiveMembership(user.id, orgId)
      : null;
    if (refreshed?.company && user) {
      return { company: refreshed.company, user, membership: refreshed };
    }
  }

  const syncedCompany = await syncTenantFromClerk(clerkUserId);
  if (syncedCompany) {
    user = user ?? (await tenantRepo.findUserByClerkId(clerkUserId));
    if (user) {
      const membership = await findActiveMembership(user.id, orgId);
      if (membership?.company) {
        return { company: membership.company, user, membership };
      }
      const loaded = await tenantRepo.findMembership(syncedCompany.id, user.id);
      if (loaded?.status === "ACTIVE") {
        return { company: syncedCompany, user, membership: loaded };
      }
    }
  }

  if (!options?.forceReconcile && !invitedMembership) {
    await reconcileInviteMembershipOnLogin(clerkUserId, orgId);
    user = user ?? (await tenantRepo.findUserByClerkId(clerkUserId));
    if (user) {
      const finalActive = await findActiveMembership(user.id, orgId);
      if (finalActive?.company) {
        return { company: finalActive.company, user, membership: finalActive };
      }
    }
  }

  return null;
}

export async function resolveAuthenticatedTenant(
  clerkUserId: string,
  orgId?: string | null,
  options?: {
    resolutionCache?: ResolutionCache;
    forceReconcile?: boolean;
  },
): Promise<ResolvedTenant | null> {
  const start = performance.now();

  if (options?.resolutionCache?.tenant !== undefined) {
    return options.resolutionCache.tenant;
  }

  const resolve = async (): Promise<ResolvedTenant | null> => {
    const fromRedis = await loadFromResolvedCache(clerkUserId);
    if (fromRedis) {
      scheduleBackgroundReconciliation(clerkUserId, orgId);
      return fromRedis;
    }

    const fromMongo = await resolveFromMongoDb(clerkUserId, orgId);
    if (fromMongo) {
      await cacheResolvedTenant(clerkUserId, fromMongo);
      scheduleBackgroundReconciliation(clerkUserId, orgId);
      return fromMongo;
    }

    const recovered = await recoverTenant(clerkUserId, orgId, {
      forceReconcile: options?.forceReconcile,
    });
    if (recovered) {
      await cacheResolvedTenant(clerkUserId, recovered);
      return recovered;
    }

    return null;
  };

  try {
    const tenant = await resolve();
    if (options?.resolutionCache) {
      options.resolutionCache.tenant = tenant;
    }

    const durationMs = Math.round(performance.now() - start);
    recordCompanyResolutionDuration(durationMs);
    logResolutionEvent("company:resolved", {
      clerkUserId,
      orgId,
      found: Boolean(tenant),
      durationMs,
    });

    return tenant;
  } catch (error) {
    gqlLogError("company:resolve:error", error, { clerkUserId, orgId });
    throw error;
  }
}

export async function resolveCompanyForAuthenticatedUser(
  clerkUserId: string,
  orgId?: string | null,
  options?: {
    resolutionCache?: ResolutionCache;
    forceReconcile?: boolean;
  },
): Promise<Company | null> {
  const tenant = await resolveAuthenticatedTenant(clerkUserId, orgId, options);
  return tenant?.company ?? null;
}
