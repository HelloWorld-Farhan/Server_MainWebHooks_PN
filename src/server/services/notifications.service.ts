import {
  buildConnection,
  encodeIdCursor,
} from "@/server/lib/pagination";
import prisma from "@/server/lib/prisma";
import {
  IntegrationsRepository,
  NotificationsRepository,
  SchedulerRepository,
} from "@/server/repositories/notifications.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { branchAccessService } from "@/server/services/branch-access.service";
import { tenantService } from "@/server/services/tenant.service";

export class NotificationsService {
  private readonly repo = new NotificationsRepository(prisma);

  async list(
    ctx: TenantContext,
    args: { first?: number; after?: string },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.NOTIFICATIONS_READ);

    const limit = Math.min(args.first ?? 20, 100);
    const items = await this.repo.listForUser(
      ctx.companyId,
      ctx.userId,
      limit,
      args.after,
    );

    return buildConnection(items, limit, (item) =>
      encodeIdCursor(item.id, item.createdAt),
    );
  }
}

export class IntegrationsService {
  private readonly repo = new IntegrationsRepository(prisma);

  async list(ctx: TenantContext) {
    if (ctx.branchAccess.type === "SELECTED") {
      return [];
    }
    tenantService.requirePermission(ctx, PERMISSIONS.INTEGRATIONS_READ);
    return this.repo.findAll(ctx.companyId);
  }
}

export class SchedulerService {
  private readonly repo = new SchedulerRepository(prisma);

  async listUpcoming(ctx: TenantContext, limit = 20) {
    tenantService.requirePermission(ctx, PERMISSIONS.SCHEDULER_READ);
    const leadBranchIds = branchAccessService.hasAllBranchAccess(ctx)
      ? undefined
      : ctx.branchAccess.branchIds;
    return this.repo.listUpcoming(
      ctx.companyId,
      Math.min(limit, 50),
      leadBranchIds,
    );
  }
}

export const notificationsService = new NotificationsService();
export const integrationsService = new IntegrationsService();
export const schedulerService = new SchedulerService();
