import type { CampaignExecutionStatus, Prisma } from "@prisma/client";

import { DEFAULT_RETRY_POLICY } from "@/server/campaign-execution/retry/retry.config";
import prisma from "@/server/lib/prisma";
import { BaseRepository } from "@/server/repositories/base.repository";

export class CampaignExecutionRepository extends BaseRepository {
  findByCampaignId(companyId: string, campaignId: string) {
    return this.prisma.campaignExecution.findFirst({
      where: { companyId, campaignId },
      include: { campaign: { select: { resourceKey: true, name: true } } },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.campaignExecution.findFirst({
      where: { id, companyId },
      include: { campaign: { select: { resourceKey: true, name: true } } },
    });
  }

  createDraft(companyId: string, campaignId: string, correlationId: string) {
    return this.prisma.campaignExecution.create({
      data: {
        companyId,
        campaignId,
        status: "DRAFT",
        correlationId,
        ...DEFAULT_RETRY_POLICY,
      },
      include: { campaign: { select: { resourceKey: true, name: true } } },
    });
  }

  transitionStatus(
    companyId: string,
    campaignId: string,
    fromStatuses: CampaignExecutionStatus[],
    data: Prisma.CampaignExecutionUpdateInput,
  ) {
    return this.prisma.campaignExecution.updateMany({
      where: {
        companyId,
        campaignId,
        status: { in: fromStatuses },
      },
      data: data as Prisma.CampaignExecutionUpdateManyMutationInput,
    });
  }

  findDueScheduled(limit: number, now: Date) {
    return this.prisma.campaignExecution.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { lte: now },
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: limit,
      include: { campaign: { select: { resourceKey: true } } },
    });
  }

  findRunningExecutions(limit: number) {
    return this.prisma.campaignExecution.findMany({
      where: { status: "RUNNING" },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      take: limit,
      include: { campaign: { select: { resourceKey: true } } },
    });
  }

  findStaleRunningLocks(now: Date) {
    return this.prisma.campaignExecution.findMany({
      where: {
        status: "RUNNING",
        OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }],
      },
      include: { campaign: { select: { resourceKey: true } } },
    });
  }

  findActiveForProgress() {
    return this.prisma.campaignExecution.findMany({
      where: { status: { in: ["RUNNING", "PAUSED"] } },
      include: { campaign: { select: { resourceKey: true } } },
    });
  }

  updateLock(
    companyId: string,
    campaignId: string,
    workerId: string,
    lockExpiresAt: Date,
  ) {
    return this.prisma.campaignExecution.updateMany({
      where: { companyId, campaignId, status: "RUNNING" },
      data: { workerId, lockExpiresAt },
    });
  }

  updateCursor(
    companyId: string,
    campaignId: string,
    lastProcessedContactId: string,
    processedCount: number,
  ) {
    return this.prisma.campaignExecution.updateMany({
      where: { companyId, campaignId, status: "RUNNING" },
      data: { lastProcessedContactId, processedCount },
    });
  }

  updateStatistics(
    companyId: string,
    campaignId: string,
    data: Prisma.CampaignExecutionUpdateManyMutationInput,
  ) {
    return this.prisma.campaignExecution.updateMany({
      where: { companyId, campaignId },
      data,
    });
  }

  countRunning() {
    return this.prisma.campaignExecution.count({
      where: { status: "RUNNING" },
    });
  }
}

export const campaignExecutionRepository = new CampaignExecutionRepository(
  prisma,
);
