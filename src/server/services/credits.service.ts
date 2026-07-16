import { cacheService } from "@/server/cache/cache.service";
import { CACHE_TTL, cacheKeys } from "@/server/cache/keys";
import {
  buildConnection,
  encodeIdCursor,
} from "@/server/lib/pagination";
import prisma from "@/server/lib/prisma";
import { CreditsRepository } from "@/server/repositories/credits.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";
import { eventsService } from "@/server/services/events.service";

export class CreditsService {
  private readonly repo = new CreditsRepository(prisma);

  async getSummary(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.CREDITS_READ);

    return cacheService.getOrSet(
      cacheKeys.companyCredits(ctx.companyId),
      CACHE_TTL.CREDITS,
      async () => {
        const balance = await this.repo.ensureBalance(ctx.companyId);
        const total = balance.creditsRemaining + balance.creditsUsed;
        const availablePercent =
          total > 0
            ? Math.round((balance.creditsRemaining / total) * 100)
            : 0;

        return {
          remaining: balance.creditsRemaining,
          used: balance.creditsUsed,
          total,
          availablePercent,
          renewalAt: balance.renewalAt?.toISOString() ?? null,
          planId: balance.planId,
        };
      },
    );
  }

  async getUsageHistory(
    ctx: TenantContext,
    args: { first?: number; after?: string },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CREDITS_READ);

    const limit = Math.min(args.first ?? 20, 100);
    const items = await this.repo.listUsage(
      ctx.companyId,
      limit,
      args.after,
    );

    return buildConnection(items, limit, (item) =>
      encodeIdCursor(item.id, item.createdAt),
    );
  }

  async debitForCall(
    ctx: TenantContext,
    callLogId: string,
    amount: number,
    description?: string,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CREDITS_WRITE);

    const usage = await this.repo.recordUsage(ctx.companyId, {
      amount,
      reason: "CALL",
      callLogId,
      description,
    });

    await cacheService.invalidateCompanyCredits(ctx.companyId);
    await cacheService.invalidateBillingPages(ctx.companyId);
    await eventsService.emit(ctx, {
      type: "CALL_COMPLETED",
      entityType: "CallLog",
      entityId: callLogId,
      title: "Credits consumed for call",
      payload: { amount },
    });

    return usage;
  }

  async adjustCredits(
    ctx: TenantContext,
    amount: number,
    description: string,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CREDITS_WRITE);

    const usage = await this.repo.recordUsage(ctx.companyId, {
      amount,
      reason: "MANUAL_ADJUSTMENT",
      description,
    });

    await cacheService.invalidateCompanyCredits(ctx.companyId);
    await cacheService.invalidateBillingPages(ctx.companyId);
    return usage;
  }
}

export const creditsService = new CreditsService();
