import { cacheService } from '@/server/cache/cache.service';
import { CACHE_TTL, cacheKeys } from '@/server/cache/keys';
import { NotFoundError, ValidationError } from '@/server/lib/errors';
import { buildConnection, encodeCursor } from '@/server/lib/pagination';
import prisma from '@/server/lib/prisma';
import {
  CallLogsRepository,
  type CallLogFilter,
} from '@/server/repositories/call-logs.repository';
import { CallInternalNoteRepository } from '@/server/repositories/call-internal-note.repository';
import type { TenantContext } from '@/server/types/context';
import { PERMISSIONS } from '@/server/types/permissions';
import { tenantService } from '@/server/services/tenant.service';
import { campaignAccessService } from '@/server/services/campaign-access.service';
import { analyticsService } from '@/server/services/analytics.service';
import { billingService } from '@/server/services/billing.service';
import { creditsService } from '@/server/services/credits.service';
import { CreditsRepository } from '@/server/repositories/credits.repository';

function mapNote(note: {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}) {
  return {
    id: note.id,
    content: note.content,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    author: {
      id: note.author.id,
      name:
        [note.author.firstName, note.author.lastName]
          .filter(Boolean)
          .join(' ') || note.author.email,
      email: note.author.email,
    },
  };
}

export class CallLogsService {
  private readonly repo = new CallLogsRepository(prisma);
  private readonly notesRepo = new CallInternalNoteRepository(prisma);

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
          campaignAccessService.callLogCampaignFilter(ctx),
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
      campaignAccessService.callLogCampaignFilter(ctx),
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
      throw new NotFoundError('Call log not found');
    }
    campaignAccessService.assertCallLogCampaignAccess(ctx, log.campaignId);

    const internalNotes = await this.notesRepo.listByCallLog(ctx.companyId, id);

    return {
      ...log,
      startedAt: log.startedAt.toISOString(),
      outcome: log.outcome,
      aiSummary: log.aiSummary,
      sentiment: log.sentiment,
      engagement: log.engagement,
      reactivationPlan: log.reactivationPlan,
      recordingUrl: log.recordingUrl,
      cost: log.cost,
      creditsUsed: log.creditsUsed,
      provider: log.provider,
      transcript: log.transcript,
      internalNotes: internalNotes.map(mapNote),
      phoneNumber: log.phoneNumber
        ? {
            id: log.phoneNumber.id,
            number: log.phoneNumber.number,
            label: log.phoneNumber.label,
          }
        : null,
    };
  }

  async updateOutcome(
    ctx: TenantContext,
    id: string,
    outcome: string,
    reactivationPlan?: Record<string, unknown> | null,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_WRITE);

    const log = await this.repo.findById(ctx.companyId, id);
    if (!log) {
      throw new NotFoundError('Call log not found');
    }
    campaignAccessService.assertCallLogCampaignAccess(ctx, log.campaignId);

    await this.repo.updateOutcome(ctx.companyId, id, outcome, reactivationPlan);
    await cacheService.invalidateCallRelated(ctx.companyId);
    return this.getDetail(ctx, id);
  }

  async addInternalNote(
    ctx: TenantContext,
    callLogId: string,
    content: string,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_WRITE);

    const log = await this.repo.findById(ctx.companyId, callLogId);
    if (!log) {
      throw new NotFoundError('Call log not found');
    }
    campaignAccessService.assertCallLogCampaignAccess(ctx, log.campaignId);

    const note = await this.notesRepo.create(
      ctx.companyId,
      callLogId,
      ctx.userId,
      content.trim(),
    );
    return mapNote(note);
  }

  async updateInternalNote(ctx: TenantContext, id: string, content: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_WRITE);

    const result = await this.notesRepo.update(
      ctx.companyId,
      id,
      content.trim(),
    );
    if (result.count === 0) {
      throw new NotFoundError('Note not found');
    }

    const notes = await prisma.callInternalNote.findFirst({
      where: { id, companyId: ctx.companyId },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
    if (!notes) {
      throw new NotFoundError('Note not found');
    }
    return mapNote(notes);
  }

  async deleteInternalNote(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_WRITE);

    const result = await this.notesRepo.delete(ctx.companyId, id);
    if (result.count === 0) {
      throw new NotFoundError('Note not found');
    }
    return true;
  }

  async onCallCompleted(
    companyId: string,
    delta: { totalCalls?: number; connectedCalls?: number },
  ) {
    await analyticsService.incrementDailyMetrics(companyId, delta);
    await cacheService.invalidateCallRelated(companyId);
  }

  /**
   * After a call ends: compute credits from duration (pulse/delta),
   * persist CallLog.creditsUsed/cost, debit balance, bump analytics.
   * Idempotent when already billed. Bills COMPLETED only.
   */
  async recordCompletedWithBilling(ctx: TenantContext, callLogId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CREDITS_WRITE);

    const log = await this.repo.findForBilling(ctx.companyId, callLogId);
    if (!log) {
      throw new NotFoundError('Call log not found');
    }
    campaignAccessService.assertCallLogCampaignAccess(ctx, log.campaignId);

    const existingUsage = await prisma.creditUsage.findFirst({
      where: { companyId: ctx.companyId, callLogId, reason: 'CALL' },
      select: { id: true, amount: true },
    });

    // Already billed — ensure CallLog fields are set, then exit
    if (existingUsage || (log.creditsUsed != null && log.creditsUsed > 0)) {
      if (existingUsage && (log.creditsUsed == null || log.creditsUsed <= 0)) {
        const config = await billingService.loadCompanyBillingConfig(
          ctx.companyId,
        );
        await this.repo.updateBilling(ctx.companyId, callLogId, {
          creditsUsed: existingUsage.amount,
          cost: existingUsage.amount * config.costPerCredit,
        });
      }
      return true;
    }

    const shouldBill = log.status === 'COMPLETED';
    if (shouldBill) {
      const config = await billingService.loadCompanyBillingConfig(
        ctx.companyId,
      );
      const { credits, costInr } = billingService.calculateCallBilling(
        log.durationSeconds,
        config,
      );

      if (credits > 0) {
        const creditsRepo = new CreditsRepository(prisma);
        const balance = await creditsRepo.ensureBalance(ctx.companyId);

        await creditsService.debitForCall(
          ctx,
          callLogId,
          credits,
          `Call billing: ${credits} credit(s), ₹${costInr.toFixed(2)}`,
        );

        await this.repo.updateBilling(ctx.companyId, callLogId, {
          creditsUsed: credits,
          cost: costInr,
        });
      }
    }

    await this.onCallCompleted(ctx.companyId, {
      totalCalls: 1,
      connectedCalls: shouldBill ? 1 : 0,
    });

    return true;
  }
}

export const callLogsService = new CallLogsService();
