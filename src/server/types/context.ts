import type { CampaignAccessType, UserRole } from "@prisma/client";
import type DataLoader from "dataloader";

import type { createDataLoaders } from "@/server/graphql/dataloaders";

export type CampaignAccessContext = {
  type: CampaignAccessType;
  campaignIds: string[];
};

export type TenantAuthType = "user" | "api_key";

export type TenantContext = {
  authType: TenantAuthType;
  userId: string;
  clerkUserId: string;
  companyId: string;
  membershipId: string;
  role: UserRole;
  permissions: string[];
  campaignAccess: CampaignAccessContext;
  loaders: ReturnType<typeof createDataLoaders>;
  /** Present when authType === "api_key" */
  apiKeyId?: string;
};

export type GraphQLContext = TenantContext & {
  isAuthenticated: boolean;
};
