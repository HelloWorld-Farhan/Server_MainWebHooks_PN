import type {
  ApiKey,
  ApiKeyCampaignAccess,
  CampaignAccessType,
} from "@prisma/client";

import { createDataLoaders } from "@/server/graphql/dataloaders";
import type { TenantContext } from "@/server/types/context";

type ApiKeyWithCampaigns = ApiKey & {
  campaignAccess: ApiKeyCampaignAccess[];
};

export function buildApiKeyTenantContext(
  apiKey: ApiKeyWithCampaigns,
): TenantContext {
  const campaignAccessType: CampaignAccessType = apiKey.campaignAccessType;
  const campaignIds =
    campaignAccessType === "ALL"
      ? []
      : apiKey.campaignAccess.map((row) => row.campaignId);

  return {
    authType: "api_key",
    apiKeyId: apiKey.id,
    userId: apiKey.createdById,
    clerkUserId: "",
    companyId: apiKey.companyId,
    membershipId: "",
    // Non-OWNER so branch-access checks are never bypassed via role.
    role: "AGENT",
    permissions: apiKey.scopes,
    campaignAccess: {
      type: campaignAccessType,
      campaignIds,
    },
    loaders: createDataLoaders(apiKey.companyId),
  };
}
