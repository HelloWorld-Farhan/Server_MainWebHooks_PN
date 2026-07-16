import { getAuthFromRequest } from "@/auth/clerk";
import { getCurrentRequest } from "@/auth/request-context";
import { gqlDebug, gqlDebugTimed, gqlLogError } from "@/server/graphql/debug";
import { UnauthorizedError } from "@/server/lib/errors";
import { buildTenantContext } from "@/server/lib/tenant-context-builder";
import {
  resolveAuthenticatedTenant,
  type ResolutionCache,
} from "@/server/services/company-resolution.service";
import type { GraphQLContext } from "@/server/types/context";

export async function createGraphQLContext(): Promise<GraphQLContext> {
  return gqlDebugTimed("context:total", async () => {
    const req = getCurrentRequest();
    const { userId, orgId } = await gqlDebugTimed("context:auth", async () => {
      if (!req) {
        return { userId: null, orgId: null };
      }
      return getAuthFromRequest(req);
    });
    gqlDebug("context:auth", {
      hasUserId: Boolean(userId),
      hasOrgId: Boolean(orgId),
    });

    if (!userId) {
      gqlDebug("context:auth:unauthorized", { reason: "no userId" });
      throw new UnauthorizedError();
    }

    const resolutionCache: ResolutionCache = {};

    let tenant;
    try {
      tenant = await gqlDebugTimed("context:resolveTenant", () =>
        resolveAuthenticatedTenant(userId, orgId, { resolutionCache }),
      );
    } catch (error) {
      gqlLogError("context:resolveTenant:error", error, {
        clerkUserId: userId,
        orgId,
      });
      throw error;
    }

    gqlDebug("context:resolveTenant", {
      orgId,
      companyFound: Boolean(tenant),
    });

    if (!tenant) {
      gqlDebug("context:noCompany", { orgId, hasUserId: Boolean(userId) });
      throw new UnauthorizedError("Organization context required");
    }

    const tenantContext = await gqlDebugTimed("context:buildTenant", () =>
      buildTenantContext(userId, tenant.company.id, tenant.membership),
    );

    gqlDebug("context:done", {
      companyId: tenant.company.id,
      userId: tenant.user.id,
      role: tenant.membership.role,
    });

    return {
      isAuthenticated: true,
      ...tenantContext,
    };
  });
}
