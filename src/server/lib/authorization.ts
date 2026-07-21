import type { Permission } from "@/lib/permissions";
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from "@/lib/permissions";
import {
  ForbiddenError,
  MissingCampaignAccessError,
  MissingScopeError,
} from "@/server/lib/errors";
import { campaignAccessService } from "@/server/services/campaign-access.service";
import type { TenantContext } from "@/server/types/context";

export function requireScope(ctx: TenantContext, scope: Permission): void {
  if (!hasPermission(ctx.permissions, scope)) {
    throw new MissingScopeError(scope);
  }
}

export function requireAllScopes(
  ctx: TenantContext,
  scopes: Permission[],
): void {
  if (!hasAllPermissions(ctx.permissions, scopes)) {
    const missing = scopes.find((s) => !ctx.permissions.includes(s));
    throw new MissingScopeError(missing ?? scopes[0]!);
  }
}

export function requireAnyScope(
  ctx: TenantContext,
  scopes: Permission[],
): void {
  if (!hasAnyPermission(ctx.permissions, scopes)) {
    throw new MissingScopeError(scopes[0]!);
  }
}

export function requireCampaignAccess(
  ctx: TenantContext,
  campaignId: string,
): void {
  try {
    campaignAccessService.assertCampaignAccess(ctx, campaignId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw new MissingCampaignAccessError(error.message);
    }
    throw error;
  }
}

export type ResourceRestriction =
  | { type: "branch"; id: string };

/**
 * Generic resource restriction layer.
 * Extend with additional resource types without redesigning authz.
 */
export function assertResourceAccess(
  ctx: TenantContext,
  resource: ResourceRestriction,
): void {
  if (resource.type === "branch") {
    requireCampaignAccess(ctx, resource.id);
    return;
  }

  throw new ForbiddenError(
    `Unsupported resource restriction: ${(resource as { type: string }).type}`,
  );
}

/** Ensures granted scopes are a subset of the principal's scopes (API-key principals). */
export function assertScopesAreSubset(
  principalScopes: string[],
  grantedScopes: string[],
): void {
  const allowed = new Set(principalScopes);
  for (const scope of grantedScopes) {
    if (!allowed.has(scope)) {
      throw new MissingScopeError(scope);
    }
  }
}

/** Ensures granted campaign ids are a subset when principal has SELECTED access. */
export function assertCampaignsAreSubset(
  ctx: TenantContext,
  campaignIds: string[],
): void {
  if (ctx.authType !== "api_key") return;
  if (ctx.campaignAccess.type === "ALL") return;
  const allowed = new Set(ctx.campaignAccess.campaignIds);
  for (const id of campaignIds) {
    if (!allowed.has(id)) {
      throw new MissingCampaignAccessError(
        "Cannot grant campaign access beyond the current API key",
      );
    }
  }
}
