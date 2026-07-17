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

  async getTimeSeries(
    ctx: TenantContext,
    granularity: AnalyticsGranularity = "DAILY",
    dateFrom?: Date,
    dateTo?: Date,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.ANALYTICS_READ);

    const period = resolvePeriod(granularity, dateFrom, dateTo);
    const logs = await this.callLogsRepo.findForTimeSeries(
      ctx.companyId,
      period.start,
      period.end,
      branchAccessService.callLogBranchFilter(ctx),
    );

    const buckets = new Map<
      string,
      {
        label: string;
        calls: number;
        connectedCalls: number;
        leads: number;
        conversions: number;
      }
    >();

    for (const log of logs) {
      const bucketDate = this.resolveBucketDate(log.startedAt, granularity);
      const key = bucketDate.toISOString();
      const existing = buckets.get(key) ?? {
        label: this.formatBucketLabel(bucketDate, granularity),
        calls: 0,
        connectedCalls: 0,
        leads: 0,
        conversions: 0,
      };

      existing.calls += 1;
      if (log.status === "COMPLETED") {
        existing.connectedCalls += 1;
      }
      if (log.leadId) {
        existing.leads += 1;
      }
      if (log.outcome === "CONVERTED" || log.outcome === "INTERESTED") {
        existing.conversions += 1;
      }

      buckets.set(key, existing);
    }

    const points = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodStart, metrics]) => ({
        periodStart,
        label: metrics.label,
        calls: metrics.calls,
        connectedCalls: metrics.connectedCalls,
        leads: metrics.leads,
        conversions: metrics.conversions,
        conversionRate:
          metrics.calls > 0
            ? Math.round((metrics.conversions / metrics.calls) * 1000) / 10
            : 0,
      }));

    return {
      granularity,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      points,
    };
  }

  private resolveBucketDate(date: Date, granularity: AnalyticsGranularity) {
    const bucket = new Date(date);
    bucket.setUTCHours(0, 0, 0, 0);

    if (granularity === "WEEKLY") {
      const day = bucket.getUTCDay();
      bucket.setUTCDate(bucket.getUTCDate() - day);
    }

    if (granularity === "MONTHLY") {
      bucket.setUTCDate(1);
    }

    return bucket;
  }

  private formatBucketLabel(date: Date, granularity: AnalyticsGranularity) {
    if (granularity === "MONTHLY") {
      return date.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
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
