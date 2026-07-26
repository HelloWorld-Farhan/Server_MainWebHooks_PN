import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

import { NotFoundError, ValidationError } from "@/server/lib/errors";
import {
  resolveResourceId,
  toCampaignPublicId,
} from "@/server/lib/public-id/mapper";
import { PublicResourceType } from "@/server/lib/public-id/types";
import prisma from "@/server/lib/prisma";
import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";
import { campaignExecutionLockService } from "@/server/campaign-execution/campaign-execution-lock.service";
import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import type {
  CampaignExecutionProgress,
  CampaignExecutionStatistics,
  CampaignExecutionView,
  CampaignRetryPolicyInput,
  CampaignRetryPolicyView,
} from "@/server/campaign-execution/campaign-execution.types";
import { retryJobRepository } from "@/server/campaign-execution/retry/retry-job.repository";
import {
  retryStatisticsService,
  type CampaignRetryStatistics,
  type CampaignRetrySummary,
  type ContactRetryHistoryEntry,
} from "@/server/campaign-execution/retry/retry-statistics.service";
import { logCampaignExecutionEvent } from "@/server/campaign-execution/lib/campaign-execution-logger";
import { createSystemTenantContext } from "@/server/campaign-execution/lib/system-tenant-context";
import { CampaignsRepository } from "@/server/repositories/campaigns.repository";
import { campaignAccessService } from "@/server/services/campaign-access.service";
import { tenantService } from "@/server/services/tenant.service";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";

type ExecutionRow = NonNullable<
  Awaited<ReturnType<typeof campaignExecutionRepository.findByCampaignId>>
>;

function mapExecution(
  row: ExecutionRow,
  campaignPublicId: string,
): CampaignExecutionView {
  return {
    id: row.id,
    campaignId: campaignPublicId,
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    processedCount: row.processedCount,
    totalContacts: row.totalContacts,
    correlationId: row.correlationId,
    failureReason: row.failureReason,
    estimatedCompletionAt: row.estimatedCompletionAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class CampaignExecutionService {
  private readonly campaignsRepo = new CampaignsRepository(prisma);

  private async resolveCampaign(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<{ internalId: string; publicId: string; resourceKey: string }> {
    const internalId = await resolveResourceId(
      ctx,
      campaignPublicId,
      PublicResourceType.CAMPAIGN,
    );

    const campaign = await prisma.campaign.findFirst({
      where: { id: internalId, companyId: ctx.companyId },
      select: { id: true, resourceKey: true },
    });
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }

    campaignAccessService.assertCampaignAccess(ctx, campaign.id);

    const publicId = await toCampaignPublicId(ctx, campaign.resourceKey);
    return {
      internalId: campaign.id,
      publicId,
      resourceKey: campaign.resourceKey,
    };
  }

  private async getOrCreateExecution(
    companyId: string,
    campaignId: string,
    correlationId?: string,
  ): Promise<ExecutionRow> {
    const existing = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (existing) {
      return existing;
    }

    return campaignExecutionRepository.createDraft(
      companyId,
      campaignId,
      correlationId ?? randomUUID(),
    );
  }

  private async loadExecutionView(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionView> {
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const row = await this.getOrCreateExecution(
      ctx.companyId,
      campaign.internalId,
    );
    return mapExecution(row, campaign.publicId);
  }

  private async writeActivity(
    companyId: string,
    campaignId: string,
    type: string,
    summary: string,
    actorId?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.campaignsRepo.createActivity(companyId, campaignId, {
      type,
      summary,
      actorId,
      metadata,
    });
  }

  async getStatus(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    return this.loadExecutionView(ctx, campaignPublicId);
  }

  async getStatistics(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionStatistics> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const row = await campaignExecutionRepository.findByCampaignId(
      ctx.companyId,
      campaign.internalId,
    );
    if (!row) {
      const totalContacts = await this.campaignsRepo.countContacts(
        ctx.companyId,
        campaign.internalId,
      );
      return {
        totalContacts,
        processed: 0,
        pending: totalContacts,
        queued: 0,
        dialing: 0,
        answered: 0,
        busy: 0,
        noAnswer: 0,
        failed: 0,
        completed: 0,
        completedContacts: 0,
        initialCalls: 0,
        retryCalls: 0,
        pendingRetries: 0,
        totalRetries: 0,
        retrySuccessRate: 0,
        averageRetryCount: 0,
      };
    }

    const retryStats = await retryStatisticsService.getStatistics(
      ctx.companyId,
      campaign.internalId,
    );

    return {
      totalContacts: row.totalContacts,
      processed: row.processedCount,
      pending: Math.max(row.totalContacts - row.completedContactsCount, 0),
      queued: row.statsQueued,
      dialing: row.statsDialing,
      answered: row.statsAnswered,
      busy: row.statsBusy,
      noAnswer: row.statsNoAnswer,
      failed: row.statsFailed,
      completed: row.statsCompleted,
      completedContacts: row.completedContactsCount,
      initialCalls: retryStats.initialCalls,
      retryCalls: retryStats.retryCalls,
      pendingRetries: retryStats.pendingRetries,
      totalRetries: row.totalRetries,
      retrySuccessRate: retryStats.retrySuccessRate,
      averageRetryCount: retryStats.averageRetryCount,
    };
  }

  async getProgress(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionProgress> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const row = await campaignExecutionRepository.findByCampaignId(
      ctx.companyId,
      campaign.internalId,
    );
    const totalContacts =
      row?.totalContacts ??
      (await this.campaignsRepo.countContacts(
        ctx.companyId,
        campaign.internalId,
      ));
    const processedCount = row?.processedCount ?? 0;
    const percentComplete =
      totalContacts > 0
        ? Math.min(
            100,
            Math.round(
              ((row?.completedContactsCount ?? 0) / totalContacts) * 100,
            ),
          )
        : 0;

    return {
      processedCount: row?.completedContactsCount ?? 0,
      totalContacts,
      percentComplete,
      estimatedCompletionAt:
        row?.estimatedCompletionAt?.toISOString() ?? null,
    };
  }

  async schedule(
    ctx: TenantContext,
    campaignPublicId: string,
    scheduledAtInput: string,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const scheduledAt = new Date(scheduledAtInput);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new ValidationError("Invalid scheduledAt value");
    }

    await this.getOrCreateExecution(ctx.companyId, campaign.internalId);
    const result = await campaignExecutionRepository.transitionStatus(
      ctx.companyId,
      campaign.internalId,
      ["DRAFT", "SCHEDULED"],
      {
        status: "SCHEDULED",
        scheduledAt,
        pausedAt: null,
        failureReason: null,
      },
    );
    if (result.count === 0) {
      throw new ValidationError(
        "Campaign cannot be scheduled from its current state",
      );
    }

    logCampaignExecutionEvent("campaign:scheduled", {
      campaignPublicId: campaign.publicId,
      scheduledAt: scheduledAt.toISOString(),
    });

    await this.writeActivity(
      ctx.companyId,
      campaign.internalId,
      "CAMPAIGN_EXECUTION_SCHEDULED",
      `Campaign scheduled for ${scheduledAt.toISOString()}`,
      ctx.userId,
      { scheduledAt: scheduledAt.toISOString() },
    );

    return this.loadExecutionView(ctx, campaignPublicId);
  }

  async start(
    ctx: TenantContext,
    campaignPublicId: string,
    scheduledAtInput?: string | null,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);

    if (scheduledAtInput) {
      const scheduledAt = new Date(scheduledAtInput);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new ValidationError("Invalid scheduledAt value");
      }
      if (scheduledAt.getTime() > Date.now()) {
        return this.schedule(ctx, campaignPublicId, scheduledAtInput);
      }
    }

    const correlationId = randomUUID();
    await this.getOrCreateExecution(
      ctx.companyId,
      campaign.internalId,
      correlationId,
    );

    const totalContacts = await this.campaignsRepo.countContacts(
      ctx.companyId,
      campaign.internalId,
    );

    const now = new Date();
    const lockExpiresAt = new Date(
      now.getTime() + campaignExecutionConfig.lockTtlMs,
    );

    const result = await campaignExecutionRepository.transitionStatus(
      ctx.companyId,
      campaign.internalId,
      ["DRAFT", "SCHEDULED", "PAUSED"],
      {
        status: "RUNNING",
        startedAt: now,
        scheduledAt: null,
        pausedAt: null,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        failureReason: null,
        correlationId,
        totalContacts,
        workerId: campaignExecutionConfig.workerId,
        lockExpiresAt,
      },
    );

    if (result.count === 0) {
      const current = await campaignExecutionRepository.findByCampaignId(
        ctx.companyId,
        campaign.internalId,
      );
      if (current?.status === "RUNNING") {
        return mapExecution(current, campaign.publicId);
      }
      throw new ValidationError(
        "Campaign cannot be started from its current state",
      );
    }

    logCampaignExecutionEvent("campaign:started", {
      campaignPublicId: campaign.publicId,
      correlationId,
      totalContacts,
    });

    await this.writeActivity(
      ctx.companyId,
      campaign.internalId,
      "CAMPAIGN_EXECUTION_STARTED",
      "Campaign execution started",
      ctx.userId,
      { correlationId, totalContacts },
    );

    return this.loadExecutionView(ctx, campaignPublicId);
  }

  async pause(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const now = new Date();

    const result = await campaignExecutionRepository.transitionStatus(
      ctx.companyId,
      campaign.internalId,
      ["RUNNING"],
      {
        status: "PAUSED",
        pausedAt: now,
      },
    );
    if (result.count === 0) {
      throw new ValidationError("Campaign is not running");
    }

    await campaignExecutionLockService.release(
      campaign.internalId,
      campaignExecutionConfig.workerId,
    );

    logCampaignExecutionEvent("campaign:paused", {
      campaignPublicId: campaign.publicId,
    });

    await this.writeActivity(
      ctx.companyId,
      campaign.internalId,
      "CAMPAIGN_EXECUTION_PAUSED",
      "Campaign execution paused",
      ctx.userId,
    );

    return this.loadExecutionView(ctx, campaignPublicId);
  }

  async resume(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const now = new Date();
    const lockExpiresAt = new Date(
      now.getTime() + campaignExecutionConfig.lockTtlMs,
    );
    const totalContacts = await this.campaignsRepo.countContacts(
      ctx.companyId,
      campaign.internalId,
    );

    // Re-scan from the start so FAILED contacts can be redialed and any
    // contacts added while paused are included. shouldDial skips successes.
    const result = await campaignExecutionRepository.transitionStatus(
      ctx.companyId,
      campaign.internalId,
      ["PAUSED"],
      {
        status: "RUNNING",
        pausedAt: null,
        workerId: campaignExecutionConfig.workerId,
        lockExpiresAt,
        totalContacts,
        lastProcessedContactId: null,
        processedCount: 0,
      },
    );
    if (result.count === 0) {
      throw new ValidationError("Campaign is not paused");
    }

    logCampaignExecutionEvent("campaign:resumed", {
      campaignPublicId: campaign.publicId,
      totalContacts,
    });

    await this.writeActivity(
      ctx.companyId,
      campaign.internalId,
      "CAMPAIGN_EXECUTION_RESUMED",
      "Campaign execution resumed",
      ctx.userId,
      { totalContacts },
    );

    return this.loadExecutionView(ctx, campaignPublicId);
  }

  /**
   * Force-restart dialing: cancel in-flight calls that block redial, clear
   * pending retries / cursor, and set the execution back to RUNNING.
   */
  async reset(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);

    const totalContacts = await this.campaignsRepo.countContacts(
      ctx.companyId,
      campaign.internalId,
    );
    if (totalContacts === 0) {
      throw new ValidationError(
        "Upload contacts before resetting the campaign.",
      );
    }

    const existing = await campaignExecutionRepository.findByCampaignId(
      ctx.companyId,
      campaign.internalId,
    );
    if (!existing) {
      throw new ValidationError("Campaign has not been started yet");
    }
    if (existing.status === "DRAFT" || existing.status === "SCHEDULED") {
      throw new ValidationError(
        "Campaign has not started yet — use Start instead",
      );
    }

    const correlationId = randomUUID();
    const now = new Date();
    const lockExpiresAt = new Date(
      now.getTime() + campaignExecutionConfig.lockTtlMs,
    );

    // Cancel calls that prevent shouldDial from placing a new outbound.
    await prisma.callLog.updateMany({
      where: {
        companyId: ctx.companyId,
        campaignId: campaign.internalId,
        status: {
          in: [
            "PENDING",
            "QUEUED",
            "DISPATCHING",
            "QUEUED_AT_PROVIDER",
            "RINGING",
            "ANSWERED",
          ],
        },
      },
      data: {
        status: "CANCELLED",
        endedAt: now,
        disconnectReason: "Campaign execution reset",
        providerCompletedAt: now,
      },
    });

    const cancelledJobs = await retryJobRepository.cancelPendingForCampaign(
      ctx.companyId,
      campaign.internalId,
    );

    const result = await campaignExecutionRepository.transitionStatus(
      ctx.companyId,
      campaign.internalId,
      ["RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
      {
        status: "RUNNING",
        startedAt: now,
        scheduledAt: null,
        pausedAt: null,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        failureReason: null,
        correlationId,
        totalContacts,
        lastProcessedContactId: null,
        processedCount: 0,
        completedContactsCount: 0,
        pendingRetries: 0,
        workerId: campaignExecutionConfig.workerId,
        lockExpiresAt,
      },
    );
    if (result.count === 0) {
      throw new ValidationError(
        "Campaign cannot be reset from its current state",
      );
    }

    await campaignExecutionLockService.release(
      campaign.internalId,
      campaignExecutionConfig.workerId,
    );

    logCampaignExecutionEvent("campaign:reset", {
      campaignPublicId: campaign.publicId,
      correlationId,
      totalContacts,
      cancelledRetryJobs: cancelledJobs.count,
    });

    await this.writeActivity(
      ctx.companyId,
      campaign.internalId,
      "CAMPAIGN_EXECUTION_RESET",
      "Campaign execution reset — dialing restarted",
      ctx.userId,
      { correlationId, totalContacts },
    );

    return this.loadExecutionView(ctx, campaignPublicId);
  }

  async retry(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);

    const totalContacts = await this.campaignsRepo.countContacts(
      ctx.companyId,
      campaign.internalId,
    );
    if (totalContacts === 0) {
      throw new ValidationError(
        "Upload contacts before retrying the campaign.",
      );
    }

    const correlationId = randomUUID();
    const now = new Date();
    const lockExpiresAt = new Date(
      now.getTime() + campaignExecutionConfig.lockTtlMs,
    );

    const result = await campaignExecutionRepository.transitionStatus(
      ctx.companyId,
      campaign.internalId,
      ["FAILED"],
      {
        status: "RUNNING",
        failedAt: null,
        failureReason: null,
        correlationId,
        totalContacts,
        workerId: campaignExecutionConfig.workerId,
        lockExpiresAt,
      },
    );
    if (result.count === 0) {
      throw new ValidationError("Campaign is not in a failed state");
    }

    logCampaignExecutionEvent("campaign:retried", {
      campaignPublicId: campaign.publicId,
      correlationId,
      totalContacts,
    });

    await this.writeActivity(
      ctx.companyId,
      campaign.internalId,
      "CAMPAIGN_EXECUTION_RETRIED",
      "Campaign execution retried after failure",
      ctx.userId,
      { correlationId, totalContacts },
    );

    return this.loadExecutionView(ctx, campaignPublicId);
  }

  async cancel(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignExecutionView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const now = new Date();

    const result = await campaignExecutionRepository.transitionStatus(
      ctx.companyId,
      campaign.internalId,
      ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED"],
      {
        status: "CANCELLED",
        cancelledAt: now,
        pausedAt: null,
        workerId: null,
        lockExpiresAt: null,
      },
    );
    if (result.count === 0) {
      throw new ValidationError("Campaign cannot be cancelled");
    }

    await prisma.callLog.updateMany({
      where: {
        companyId: ctx.companyId,
        campaignId: campaign.internalId,
        status: "QUEUED",
      },
      data: { status: "CANCELLED" },
    });

    const cancelledJobs = await retryJobRepository.cancelPendingForCampaign(
      ctx.companyId,
      campaign.internalId,
    );
    if (cancelledJobs.count > 0) {
      await campaignExecutionRepository.updateStatistics(
        ctx.companyId,
        campaign.internalId,
        {
          pendingRetries: { decrement: cancelledJobs.count },
        },
      );
    }

    await campaignExecutionLockService.release(
      campaign.internalId,
      campaignExecutionConfig.workerId,
    );

    logCampaignExecutionEvent("campaign:cancelled", {
      campaignPublicId: campaign.publicId,
    });

    await this.writeActivity(
      ctx.companyId,
      campaign.internalId,
      "CAMPAIGN_EXECUTION_CANCELLED",
      "Campaign execution cancelled",
      ctx.userId,
    );

    return this.loadExecutionView(ctx, campaignPublicId);
  }

  async promoteScheduledToRunning(
    executionId: string,
  ): Promise<boolean> {
    const row = await prisma.campaignExecution.findUnique({
      where: { id: executionId },
      include: { campaign: { select: { resourceKey: true } } },
    });
    if (!row || row.status !== "SCHEDULED") {
      return false;
    }

    const totalContacts = await this.campaignsRepo.countContacts(
      row.companyId,
      row.campaignId,
    );
    const now = new Date();
    const lockExpiresAt = new Date(
      now.getTime() + campaignExecutionConfig.lockTtlMs,
    );

    const result = await campaignExecutionRepository.transitionStatus(
      row.companyId,
      row.campaignId,
      ["SCHEDULED"],
      {
        status: "RUNNING",
        startedAt: now,
        totalContacts,
        workerId: campaignExecutionConfig.workerId,
        lockExpiresAt,
        correlationId: row.correlationId ?? randomUUID(),
      },
    );

    if (result.count > 0) {
      const campaignPublicId = await toCampaignPublicId(
        await createSystemTenantContext(row.companyId),
        row.campaign.resourceKey,
      );
      logCampaignExecutionEvent("campaign:started", {
        campaignPublicId,
        correlationId: row.correlationId ?? undefined,
        totalContacts,
        source: "scheduler",
      });
      await this.writeActivity(
        row.companyId,
        row.campaignId,
        "CAMPAIGN_EXECUTION_STARTED",
        "Campaign execution started by scheduler",
      );
    }

    return result.count > 0;
  }

  async getRetryPolicy(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignRetryPolicyView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const policy = await retryStatisticsService.getPolicy(
      ctx.companyId,
      campaign.internalId,
    );
    if (!policy) {
      throw new NotFoundError("Campaign execution not found");
    }
    return policy;
  }

  async updateRetryPolicy(
    ctx: TenantContext,
    campaignPublicId: string,
    input: CampaignRetryPolicyInput,
  ): Promise<CampaignRetryPolicyView> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    await this.getOrCreateExecution(ctx.companyId, campaign.internalId);

    if (input.maxRetries !== undefined && input.maxRetries < 0) {
      throw new ValidationError("maxRetries must be non-negative");
    }
    if (
      input.retryDelaySeconds !== undefined &&
      input.retryDelaySeconds < 0
    ) {
      throw new ValidationError("retryDelaySeconds must be non-negative");
    }

    await campaignExecutionRepository.updateStatistics(
      ctx.companyId,
      campaign.internalId,
      {
        ...(input.retryEnabled !== undefined
          ? { retryEnabled: input.retryEnabled }
          : {}),
        ...(input.maxRetries !== undefined
          ? { maxRetries: input.maxRetries }
          : {}),
        ...(input.retryDelaySeconds !== undefined
          ? { retryDelaySeconds: input.retryDelaySeconds }
          : {}),
        ...(input.retryOnBusy !== undefined
          ? { retryOnBusy: input.retryOnBusy }
          : {}),
        ...(input.retryOnNoAnswer !== undefined
          ? { retryOnNoAnswer: input.retryOnNoAnswer }
          : {}),
        ...(input.retryOnFailed !== undefined
          ? { retryOnFailed: input.retryOnFailed }
          : {}),
        ...(input.retryOnCancelled !== undefined
          ? { retryOnCancelled: input.retryOnCancelled }
          : {}),
        ...(input.retryOnVoicemail !== undefined
          ? { retryOnVoicemail: input.retryOnVoicemail }
          : {}),
        ...(input.retryOnMissed !== undefined
          ? { retryOnMissed: input.retryOnMissed }
          : {}),
      },
    );

    return this.getRetryPolicy(ctx, campaignPublicId);
  }

  async getRetryHistory(
    ctx: TenantContext,
    campaignPublicId: string,
    phoneNumber?: string,
  ): Promise<ContactRetryHistoryEntry[]> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    return retryStatisticsService.getHistory(
      ctx.companyId,
      campaign.internalId,
      phoneNumber,
    );
  }

  async getPendingRetries(ctx: TenantContext, campaignPublicId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    return retryStatisticsService.getPendingRetries(
      ctx.companyId,
      campaign.internalId,
    );
  }

  async getRetryStatistics(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignRetryStatistics> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    return retryStatisticsService.getStatistics(
      ctx.companyId,
      campaign.internalId,
    );
  }

  async getRetrySummary(
    ctx: TenantContext,
    campaignPublicId: string,
  ): Promise<CampaignRetrySummary> {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const campaign = await this.resolveCampaign(ctx, campaignPublicId);
    const summary = await retryStatisticsService.getSummary(
      ctx.companyId,
      campaign.internalId,
    );
    if (!summary) {
      throw new NotFoundError("Campaign execution not found");
    }
    return summary;
  }

  async markCompleted(companyId: string, campaignId: string): Promise<void> {
    const now = new Date();
    await campaignExecutionRepository.transitionStatus(
      companyId,
      campaignId,
      ["RUNNING"],
      {
        status: "COMPLETED",
        completedAt: now,
        workerId: null,
        lockExpiresAt: null,
      },
    );
    await campaignExecutionLockService.release(
      campaignId,
      campaignExecutionConfig.workerId,
    );

    const row = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (row) {
      const campaignPublicId = await toCampaignPublicId(
        await createSystemTenantContext(companyId),
        row.campaign.resourceKey,
      );
      logCampaignExecutionEvent("campaign:completed", {
        campaignPublicId,
        correlationId: row.correlationId ?? undefined,
        processedCount: row.processedCount,
      });
      await this.writeActivity(
        companyId,
        campaignId,
        "CAMPAIGN_EXECUTION_COMPLETED",
        "Campaign execution completed",
      );
    }
  }

  async markFailed(
    companyId: string,
    campaignId: string,
    failureReason: string,
  ): Promise<void> {
    const now = new Date();
    await campaignExecutionRepository.transitionStatus(
      companyId,
      campaignId,
      ["RUNNING"],
      {
        status: "FAILED",
        failedAt: now,
        failureReason,
        workerId: null,
        lockExpiresAt: null,
      },
    );
    await campaignExecutionLockService.release(
      campaignId,
      campaignExecutionConfig.workerId,
    );

    const row = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (row) {
      const campaignPublicId = await toCampaignPublicId(
        await createSystemTenantContext(companyId),
        row.campaign.resourceKey,
      );
      logCampaignExecutionEvent("campaign:failed", {
        campaignPublicId,
        correlationId: row.correlationId ?? undefined,
        failureReason,
      });
      await this.writeActivity(
        companyId,
        campaignId,
        "CAMPAIGN_EXECUTION_FAILED",
        `Campaign execution failed: ${failureReason}`,
        undefined,
        { failureReason },
      );
    }
  }

  async isRunning(companyId: string, campaignId: string): Promise<boolean> {
    const row = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    return row?.status === "RUNNING";
  }
}

export const campaignExecutionService = new CampaignExecutionService();
