import type { AnalyticsGranularity } from "@prisma/client";

import { cacheService } from "@/server/cache/cache.service";
import { CACHE_TTL, cacheKeys } from "@/server/cache/keys";
import prisma from "@/server/lib/prisma";
import { AnalyticsRepository } from "@/server/repositories/billing.repository";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";
import { branchAccessService } from "@/server/services/branch-access.service";

type MetricsJson = Record<string, number>;

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function resolvePeriod(
  granularity: AnalyticsGranularity,
  dateFrom?: Date,
  dateTo?: Date,
) {
  if (dateFrom || dateTo) {
    return {
      start: dateFrom ?? startOfDay(),
      end: dateTo ?? endOfDay(),
    };
  }

  const end = endOfDay();
  const dayMs = 24 * 60 * 60 * 1000;

  switch (granularity) {
    case "WEEKLY":
      return { start: new Date(end.getTime() - 7 * dayMs), end };
    case "MONTHLY":
      return { start: new Date(end.getTime() - 30 * dayMs), end };
    default:
      return { start: startOfDay(), end };
  }
}

export class AnalyticsService {
  private readonly repo = new AnalyticsRepository(prisma);
  private readonly callLogsRepo = new CallLogsRepository(prisma);

  async getSummary(
    ctx: TenantContext,
    granularity: AnalyticsGranularity = "DAILY",
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.ANALYTICS_READ);

    const period = resolvePeriod(granularity, dateFrom, dateTo);
    const cacheKey = `${cacheKeys.companyAnalytics(ctx.companyId)}:${granularity}:${period.start.toISOString()}:${period.end.toISOString()}`;

    return cacheService.getOrSet(cacheKey, CACHE_TTL.ANALYTICS, async () => {
      const { totalCalls, connectedCalls } =
        await this.callLogsRepo.countSummary(
          ctx.companyId,
          period.start,
          period.end,
          branchAccessService.callLogBranchFilter(ctx),
        );

      const conversionRate =
        totalCalls > 0
          ? Math.round((connectedCalls / totalCalls) * 1000) / 10
          : 0;

      const snapshot = await this.repo.getLatestSnapshot(
        ctx.companyId,
        granularity,
      );
      const metrics = (snapshot?.metrics as MetricsJson) ?? {};

      return {
        totalCalls,
        connectedCalls,
        conversionRate,
        generatedLeads: metrics.generatedLeads ?? 0,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      };
    });
  }

  async incrementDailyMetrics(
    companyId: string,
    delta: MetricsJson,
  ) {
    const periodStart = startOfDay();
    const periodEnd = endOfDay();

    await this.repo.upsertDailySnapshot(
      companyId,
      periodStart,
      periodEnd,
      delta,
    );

    await cacheService.invalidateCompanyAnalytics(companyId);
  }
}

export const analyticsService = new AnalyticsService();
