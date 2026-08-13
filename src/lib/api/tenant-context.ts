import type { Request } from "express";

import { getAuthFromRequest } from "@/auth/clerk";
import { tryAuthenticateApiKeyFromRequest } from "@/server/auth/api-key-auth";
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
import * as jwt from "jsonwebtoken";
import prisma from "@/server/lib/prisma";

async function tryAuthenticateCustomJwt(req: Request): Promise<{ userId: string; orgId: string | null } | null> {
  const authHeader = req.headers.authorization || (req.headers as any)["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "default-secret-key") as jwt.JwtPayload;
    if (payload && payload.sub) {
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) {
        return { userId: user.clerkUserId, orgId: null };
      }
    }
  } catch (error) {
    return null;
  }
  return null;
}

export type ApiErrorBody = { status: number; body: Record<string, unknown> };

export async function resolveTenantContext(
  req: Request,
): Promise<TenantContext | null> {
  const apiKeyCtx = await tryAuthenticateApiKeyFromRequest(req);
  if (apiKeyCtx) return apiKeyCtx;

  let userId: string | null = null;
  let orgId: string | null = null;

  const customAuth = await tryAuthenticateCustomJwt(req);
  if (customAuth) {
    userId = customAuth.userId;
    orgId = customAuth.orgId;
  } else {
    try {
      const auth = await getAuthFromRequest(req);
      userId = auth.userId;
      orgId = auth.orgId;
    } catch (e) {
      // Clerk is not configured or failed, ignore
    }
  }
  if (!userId) return null;

  const tenant = await resolveAuthenticatedTenant(userId, orgId);
  if (!tenant) return null;

  return buildTenantContext(userId, tenant.company.id, tenant.membership);
}



export async function requireTenantContext(req: Request) {
  try {
    const apiKeyCtx = await tryAuthenticateApiKeyFromRequest(req);
    if (apiKeyCtx) {
      return { error: null, ctx: apiKeyCtx };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unauthorized";
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 401;
    return {
      error: { status, body: { error: message } } satisfies ApiErrorBody,
      ctx: null,
    };
  }

  try {
    let userId: string | null = null;
    let orgId: string | null = null;

    const customAuth = await tryAuthenticateCustomJwt(req);
    if (customAuth) {
      userId = customAuth.userId;
      orgId = customAuth.orgId;
    } else {
      try {
        const auth = await getAuthFromRequest(req);
        userId = auth.userId;
        orgId = auth.orgId;
      } catch (e) {
        // Clerk is not configured or failed, ignore
      }
    }
    
    if (!userId) {
      return {
        error: { status: 401, body: { error: "Unauthorized" } } satisfies ApiErrorBody,
        ctx: null,
      };
    }

    const tenant = await resolveAuthenticatedTenant(userId, orgId);
    if (!tenant) {
      return {
        error: {
          status: 403,
          body: { error: "Tenant not provisioned" },
        } satisfies ApiErrorBody,
        ctx: null,
      };
    }

    const ctx = await buildTenantContext(
      userId,
      tenant.company.id,
      tenant.membership,
    );
    return { error: null, ctx };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unauthorized";
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 401;
    return {
      error: { status, body: { error: message } } satisfies ApiErrorBody,
      ctx: null,
    };
  }
}

function tenantToAccess(ctx: TenantContext): AccessContext {
  return {
    membershipId: ctx.membershipId,
    userId: ctx.userId,
    role: ctx.role as AccessContext["role"],
    permissions: ctx.permissions,
    campaignAccessType: ctx.campaignAccess.type,
    campaignIds: ctx.campaignAccess.campaignIds,
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
