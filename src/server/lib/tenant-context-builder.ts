import type { CompanyMember, User } from "@prisma/client";

import { createDataLoaders } from "@/server/graphql/dataloaders";
import { buildCampaignAccessFromMember } from "@/server/services/campaign-access.service";
import { tenantService } from "@/server/services/tenant.service";
import type { TenantContext } from "@/server/types/context";

type MembershipWithRelations = CompanyMember & {
  user: User;
  customRole?: { permissions: string[] } | null;
  campaignAccess?: { campaignId: string }[];
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
    authType: "user",
    userId: membership.user.id,
    clerkUserId,
    companyId,
    membershipId: membership.id,
    role: membership.role,
    permissions,
    campaignAccess: buildCampaignAccessFromMember({
      campaignAccessType: membership.campaignAccessType,
      campaignAccess: membership.campaignAccess,
      role: membership.role,
    }),
    loaders: createDataLoaders(companyId),
  };
}
