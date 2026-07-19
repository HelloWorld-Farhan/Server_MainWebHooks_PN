import type { Permission } from "@/lib/permissions";
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from "@/lib/permissions";
import {
  ForbiddenError,
  MissingBranchAccessError,
  MissingScopeError,
} from "@/server/lib/errors";
import { branchAccessService } from "@/server/services/branch-access.service";
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

export function requireBranchAccess(
  ctx: TenantContext,
  branchId: string,
): void {
  try {
    branchAccessService.assertBranchAccess(ctx, branchId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw new MissingBranchAccessError(error.message);
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
    requireBranchAccess(ctx, resource.id);
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

/** Ensures granted branch ids are a subset when principal has SELECTED access. */
export function assertBranchesAreSubset(
  ctx: TenantContext,
  branchIds: string[],
): void {
  if (ctx.authType !== "api_key") return;
  if (ctx.branchAccess.type === "ALL") return;
  const allowed = new Set(ctx.branchAccess.branchIds);
  for (const id of branchIds) {
    if (!allowed.has(id)) {
      throw new MissingBranchAccessError(
        "Cannot grant branch access beyond the current API key",
      );
    }
  }
}
