import type { Request } from "express";

import { getAuthFromRequest } from "@/auth/clerk";
import { buildTenantContext } from "@/server/lib/tenant-context-builder";
import { resolveAuthenticatedTenant } from "@/server/services/company-resolution.service";
import type { Permission } from "@/lib/permissions";
import {
  ctxHasAllPermissions,
  ctxHasAnyPermission,
  ctxHasPermission,
  type AccessContext,
} from "@/lib/permissions-policy";
import { ForbiddenError } from "@/server/lib/errors";
import type { TenantContext } from "@/server/types/context";

export type ApiErrorBody = { status: number; body: Record<string, unknown> };

export async function resolveTenantContext(
  req: Request,
): Promise<TenantContext | null> {
  const { userId, orgId } = await getAuthFromRequest(req);
  if (!userId) return null;

  const tenant = await resolveAuthenticatedTenant(userId, orgId);
  if (!tenant) return null;

  return buildTenantContext(userId, tenant.company.id, tenant.membership);
}

export async function requireTenantContext(req: Request) {
  const ctx = await resolveTenantContext(req);
  if (!ctx) {
    return {
      error: { status: 401, body: { error: "Unauthorized" } } satisfies ApiErrorBody,
      ctx: null,
    };
  }
  return { error: null, ctx };
}

function tenantToAccess(ctx: TenantContext): AccessContext {
  return {
    membershipId: ctx.membershipId,
    userId: ctx.userId,
    role: ctx.role as AccessContext["role"],
    permissions: ctx.permissions,
    branchAccessType: ctx.branchAccess.type,
    branchIds: ctx.branchAccess.branchIds,
  };
}

export async function requireTenantPermission(
  req: Request,
  permission: Permission,
) {
  const result = await requireTenantContext(req);
  if (result.error || !result.ctx) return result;

  if (!ctxHasPermission(tenantToAccess(result.ctx), permission)) {
    return {
      error: {
        status: 403,
        body: { error: `Missing permission: ${permission}` },
      } satisfies ApiErrorBody,
      ctx: null,
    };
  }

  return result;
}

export async function requireTenantPermissions(
  req: Request,
  permissions: Permission[],
  mode: "any" | "all" = "all",
) {
  const result = await requireTenantContext(req);
  if (result.error || !result.ctx) return result;

  const access = tenantToAccess(result.ctx);
  const allowed =
    mode === "any"
      ? ctxHasAnyPermission(access, permissions)
      : ctxHasAllPermissions(access, permissions);

  if (!allowed) {
    return {
      error: {
        status: 403,
        body: { error: "Missing required permissions" },
      } satisfies ApiErrorBody,
      ctx: null,
    };
  }

  return result;
}

export function assertTenantPermission(
  ctx: TenantContext,
  permission: Permission,
) {
  if (!ctxHasPermission(tenantToAccess(ctx), permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}
