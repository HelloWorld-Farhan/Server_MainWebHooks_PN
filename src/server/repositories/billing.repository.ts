import type { AnalyticsGranularity } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";

export class BillingRepository extends BaseRepository {
  getSubscription(companyId: string) {
    return this.prisma.billingSubscription.findUnique({
      where: { companyId },
    });
  }

  listInvoices(companyId: string, limit: number, after?: string) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.billingInvoice.findMany({
      where: this.scope(companyId),
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }
}

export class AnalyticsRepository extends BaseRepository {
  getLatestSnapshot(companyId: string, granularity: AnalyticsGranularity) {
    return this.prisma.analyticsSnapshot.findFirst({
      where: {
        companyId,
        granularity,
        scope: "WORKSPACE",
        scopeId: "global",
      },
      orderBy: { periodStart: "desc" },
    });
  }

  async upsertDailySnapshot(
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
    metricsDelta: Record<string, number>,
  ) {
    const existing = await this.prisma.analyticsSnapshot.findUnique({
      where: {
        companyId_granularity_periodStart_scope_scopeId: {
          companyId,
          granularity: "DAILY",
          periodStart,
          scope: "WORKSPACE",
          scopeId: "global",
        },
      },
    });

    const currentMetrics = (existing?.metrics as Record<string, number>) ?? {};
    const mergedMetrics = { ...currentMetrics };
    for (const [key, value] of Object.entries(metricsDelta)) {
      mergedMetrics[key] = (mergedMetrics[key] ?? 0) + value;
    }

    return this.prisma.analyticsSnapshot.upsert({
      where: {
        companyId_granularity_periodStart_scope_scopeId: {
          companyId,
          granularity: "DAILY",
          periodStart,
          scope: "WORKSPACE",
          scopeId: "global",
        },
      },
      create: {
        companyId,
        granularity: "DAILY",
        periodStart,
        periodEnd,
        scope: "WORKSPACE",
        scopeId: "global",
        metrics: mergedMetrics,
      },
      update: {
        metrics: mergedMetrics,
        periodEnd,
      },
    });
  }
}
