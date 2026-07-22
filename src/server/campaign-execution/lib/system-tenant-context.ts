import { publicIdResolver } from "@/server/services/public-id-resolver.service";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";

export async function createSystemTenantContext(
  companyId: string,
): Promise<TenantContext> {
  const companyPublicIdentity =
    await publicIdResolver.getCompanyPublicIdentity(companyId);

  return {
    authType: "user",
    userId: "system",
    clerkUserId: "system",
    companyId,
    membershipId: "system",
    role: "OWNER",
    permissions: [
      PERMISSIONS.CALL_LOGS_WRITE,
      PERMISSIONS.CAMPAIGNS_WRITE,
      PERMISSIONS.CAMPAIGNS_READ,
    ],
    campaignAccess: { type: "ALL", campaignIds: [] },
    loaders: {} as TenantContext["loaders"],
    companyPublicIdentity,
  };
}
