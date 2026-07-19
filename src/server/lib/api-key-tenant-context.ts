import type {
  ApiKey,
  ApiKeyBranchAccess,
  BranchAccessType,
} from "@prisma/client";

import { createDataLoaders } from "@/server/graphql/dataloaders";
import type { TenantContext } from "@/server/types/context";

type ApiKeyWithBranches = ApiKey & {
  branchAccess: ApiKeyBranchAccess[];
};

export function buildApiKeyTenantContext(
  apiKey: ApiKeyWithBranches,
): TenantContext {
  const branchAccessType: BranchAccessType = apiKey.branchAccessType;
  const branchIds =
    branchAccessType === "ALL"
      ? []
      : apiKey.branchAccess.map((row) => row.branchId);

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
    branchAccess: {
      type: branchAccessType,
      branchIds,
    },
    loaders: createDataLoaders(apiKey.companyId),
  };
}
