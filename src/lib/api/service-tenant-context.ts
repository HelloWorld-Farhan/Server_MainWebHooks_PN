import { UserRole } from "@prisma/client";

import { createDataLoaders } from "@/server/graphql/dataloaders";
import type { TenantContext } from "@/server/types/context";

const SERVICE_USER_ID = "agent-server";
const SERVICE_CLERK_USER_ID = "agent-server";

export function createServiceTenantContext(companyId: string): TenantContext {
  return {
    userId: SERVICE_USER_ID,
    clerkUserId: SERVICE_CLERK_USER_ID,
    companyId,
    membershipId: "service",
    role: UserRole.OWNER,
    permissions: [],
    branchAccess: { type: "ALL", branchIds: [] },
    loaders: createDataLoaders(companyId),
  };
}
