import type { CallVolumeRange, PrimaryUseCase } from "@prisma/client";

import { cacheService } from "@/server/cache/cache.service";
import { CACHE_TTL, cacheKeys } from "@/server/cache/keys";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import { TenantRepository } from "@/server/repositories/tenant.repository";
import { resolveOrMergeUserFromClerk, ensureActiveCompanyMembership } from "@/server/services/clerk-provision.service";
import type { TenantContext } from "@/server/types/context";
import {
  getPermissionsForRole,
  hasPermission,
  mergePermissions,
  type Permission,
} from "@/server/types/permissions";

export class TenantService {
  private readonly repo = new TenantRepository(prisma);

  async resolveCompany(clerkOrgId: string | null | undefined) {
    if (!clerkOrgId) {
      throw new UnauthorizedError("Organization context required");
    }

    const company = await this.repo.findCompanyByClerkOrgId(clerkOrgId);
    if (!company) {
      throw new NotFoundError("Company not found");
    }

    return company;
  }

  async resolveMembership(companyId: string, clerkUserId: string) {
    const user = await this.ensureUserFromClerk(clerkUserId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    let membership = await this.repo.findMembership(companyId, user.id);
    if (!membership || membership.status !== "ACTIVE") {
      await ensureActiveCompanyMembership(companyId, clerkUserId);
      membership = await this.repo.findMembership(companyId, user.id);
    }

    if (!membership || membership.status !== "ACTIVE") {
      throw new ForbiddenError("Not a member of this organization");
    }

    return { user, membership };
  }

  async resolveMembershipFromRecord(
    companyId: string,
    clerkUserId: string,
    membership: NonNullable<Awaited<ReturnType<TenantRepository["findMembership"]>>>,
  ) {
    if (membership.status !== "ACTIVE" || membership.companyId !== companyId) {
      throw new ForbiddenError("Not a member of this organization");
    }

    return { user: membership.user, membership };
  }

  async getPermissions(
    userId: string,
    role: TenantContext["role"],
    customPermissions: string[] = [],
  ): Promise<string[]> {
    return cacheService.getOrSet(
      cacheKeys.userPermissions(userId),
      CACHE_TTL.PERMISSIONS,
      async () => {
        const rolePermissions = getPermissionsForRole(role);
        return mergePermissions(rolePermissions, customPermissions);
      },
    );
  }

  requirePermission(ctx: TenantContext, permission: Permission) {
    if (!hasPermission(ctx.permissions, permission)) {
      throw new ForbiddenError(`Missing permission: ${permission}`);
    }
  }

  async syncUserFromClerk(data: {
    clerkUserId: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    imageUrl?: string | null;
    phone?: string | null;
  }) {
    return this.repo.upsertUser(data);
  }

  async ensureUserFromClerk(clerkUserId: string) {
    const existing = await this.repo.findUserByClerkId(clerkUserId);
    if (existing) {
      return existing;
    }

    return resolveOrMergeUserFromClerk(clerkUserId);
  }

  async syncCompanyFromClerk(data: {
    clerkOrganizationId: string;
    name: string;
    slug: string;
    primaryUseCase?: PrimaryUseCase | null;
    callVolume?: CallVolumeRange | null;
  }) {
    return this.repo.upsertCompany(data);
  }

  async syncMembership(data: {
    companyId: string;
    userId: string;
    role: TenantContext["role"];
  }) {
    return this.repo.upsertMembership(data);
  }

  async getViewer(ctx: TenantContext) {
    const membership = await this.repo.findMembership(ctx.companyId, ctx.userId);
    if (!membership) {
      throw new NotFoundError("Membership not found");
    }

    const contact = await this.repo.findCompanyContact(ctx.companyId);

    return {
      id: membership.user.id,
      membershipId: membership.id,
      email: membership.user.email,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      role: membership.role,
      permissions: ctx.permissions,
      branchAccessType: membership.branchAccessType,
      branchIds:
        ctx.branchAccess.type === "ALL" ? [] : ctx.branchAccess.branchIds,
      company: {
        id: membership.company.id,
        name: membership.company.name,
        slug: membership.company.slug,
        contact: contact
          ? {
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              title: contact.title,
            }
          : null,
      },
    };
  }
}

export const tenantService = new TenantService();
