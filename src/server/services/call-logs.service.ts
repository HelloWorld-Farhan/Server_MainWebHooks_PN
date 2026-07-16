import { cacheService } from "@/server/cache/cache.service";
import { CACHE_TTL, cacheKeys } from "@/server/cache/keys";
import { NotFoundError } from "@/server/lib/errors";
import {
  buildConnection,
  encodeCursor,
} from "@/server/lib/pagination";
import prisma from "@/server/lib/prisma";
import {
  CallLogsRepository,
  type CallLogFilter,
} from "@/server/repositories/call-logs.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";
import { branchAccessService } from "@/server/services/branch-access.service";
import { analyticsService } from "@/server/services/analytics.service";

export class CallLogsService {
  private readonly repo = new CallLogsRepository(prisma);

  async getRecent(ctx: TenantContext, limit = 10) {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_READ);

    const capped = Math.min(limit, 20);

    return cacheService.getOrSet(
      cacheKeys.companyTopCallLogs(ctx.companyId),
      CACHE_TTL.TOP_CALL_LOGS,
      async () => {
        const logs = await this.repo.findRecent(
          ctx.companyId,
          capped,
          branchAccessService.callLogBranchFilter(ctx),
        );
        return logs.map((log) => ({
          ...log,
          startedAt: log.startedAt.toISOString(),
        }));
      },
    );
  }

  async getConnection(
    ctx: TenantContext,
    args: {
      first?: number;
      after?: string;
      filter?: CallLogFilter;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_READ);

    const limit = Math.min(args.first ?? 20, 100);
    const items = await this.repo.findConnection(
      ctx.companyId,
      limit,
      args.after,
      args.filter,
      branchAccessService.callLogBranchFilter(ctx),
    );

    const connection = buildConnection(items, limit, (item) =>
      encodeCursor(item.startedAt, item.id),
    );

    return {
      ...connection,
      edges: connection.edges.map(({ node, cursor }) => ({
        cursor,
        node: {
          ...node,
          startedAt: node.startedAt.toISOString(),
        },
      })),
    };
  }

  async getDetail(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_READ);

    const log = await this.repo.findById(ctx.companyId, id);
    if (!log) {
      throw new NotFoundError("Call log not found");
    }
    branchAccessService.assertCallLogBranchAccess(ctx, log.branchId);

    return {
      ...log,
      startedAt: log.startedAt.toISOString(),
      outcome: log.outcome,
      aiSummary: log.aiSummary,
      sentiment: log.sentiment,
      engagement: log.engagement,
      recordingUrl: log.recordingUrl,
      cost: log.cost,
      creditsUsed: log.creditsUsed,
      provider: log.provider,
      transcript: log.transcript,
      phoneNumber: log.phoneNumber
        ? {
            id: log.phoneNumber.id,
            number: log.phoneNumber.number,
            label: log.phoneNumber.label,
          }
        : null,
    };
  }

  async onCallCompleted(
    companyId: string,
    delta: { totalCalls?: number; connectedCalls?: number },
  ) {
    await analyticsService.incrementDailyMetrics(companyId, delta);
    await cacheService.invalidateCallRelated(companyId);
  }
}

export const callLogsService = new CallLogsService();
