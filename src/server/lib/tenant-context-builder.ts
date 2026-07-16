import type { CompanyMember, User } from "@prisma/client";

import { createDataLoaders } from "@/server/graphql/dataloaders";
import { buildBranchAccessFromMember } from "@/server/services/branch-access.service";
import { tenantService } from "@/server/services/tenant.service";
import type { TenantContext } from "@/server/types/context";

type MembershipWithRelations = CompanyMember & {
  user: User;
  customRole?: { permissions: string[] } | null;
  branchAccess?: { branchId: string }[];
};

export async function buildTenantContext(
  clerkUserId: string,
  companyId: string,
  membership: MembershipWithRelations,
): Promise<TenantContext> {
  const customPermissions = membership.customRole?.permissions ?? [];
  const permissions = await tenantService.getPermissions(
    membership.user.id,
    membership.role,
    customPermissions,
  );

  return {
    userId: membership.user.id,
    clerkUserId,
    companyId,
    membershipId: membership.id,
    role: membership.role,
    permissions,
    branchAccess: buildBranchAccessFromMember({
      branchAccessType: membership.branchAccessType,
      branchAccess: membership.branchAccess,
      role: membership.role,
    }),
    loaders: createDataLoaders(companyId),
  };
}
