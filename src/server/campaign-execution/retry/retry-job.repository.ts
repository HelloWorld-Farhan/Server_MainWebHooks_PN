import type { CallStatus, ContactRetryJobStatus, Prisma } from "@prisma/client";

import { withPrismaWriteRetry } from "@/server/lib/prisma-write-retry";
import prisma from "@/server/lib/prisma";
import { BaseRepository } from "@/server/repositories/base.repository";

export type CreateRetryJobInput = {
  companyId: string;
  campaignId: string;
  parentCallLogId: string;
  phoneNumber: string;
  retryNumber: number;
  retryReason: CallStatus;
  correlationId?: string;
  scheduledAt: Date;
};

export class RetryJobRepository extends BaseRepository {
  create(data: CreateRetryJobInput) {
    return this.prisma.contactRetryJob.create({ data });
  }

  findDuePending(limit: number, now: Date) {
    return this.prisma.contactRetryJob.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: now },
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  }

  findByParentCallLogId(parentCallLogId: string) {
    return this.prisma.contactRetryJob.findUnique({
      where: { parentCallLogId },
    });
  }

  findPendingForCampaign(companyId: string, campaignId: string) {
    return this.prisma.contactRetryJob.findMany({
      where: {
        companyId,
        campaignId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    });
  }

  findHistoryForCampaign(companyId: string, campaignId: string, phoneNumber?: string) {
    return this.prisma.contactRetryJob.findMany({
      where: {
        companyId,
        campaignId,
        ...(phoneNumber ? { phoneNumber } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  countPendingForPhone(
    companyId: string,
    campaignId: string,
    phoneNumber: string,
  ) {
    return this.prisma.contactRetryJob.count({
      where: {
        companyId,
        campaignId,
        phoneNumber,
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
  }

  claimJob(id: string) {
    return this.prisma.contactRetryJob.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
  }

  completeJob(
    id: string,
    data: {
      createdCallLogId: string;
      processedAt: Date;
    },
  ) {
    return this.prisma.contactRetryJob.update({
      where: { id },
      data: {
        status: "COMPLETED",
        createdCallLogId: data.createdCallLogId,
        processedAt: data.processedAt,
      },
    });
  }

  skipJob(id: string, skipReason: string) {
    return this.prisma.contactRetryJob.update({
      where: { id },
      data: {
        status: "SKIPPED",
        skipReason,
        processedAt: new Date(),
      },
    });
  }

  failJob(id: string, skipReason: string) {
    return this.prisma.contactRetryJob.update({
      where: { id },
      data: {
        status: "FAILED",
        skipReason,
        processedAt: new Date(),
      },
    });
  }

  cancelPendingForCampaign(companyId: string, campaignId: string) {
    return this.prisma.contactRetryJob.updateMany({
      where: {
        companyId,
        campaignId,
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
        skipReason: "Campaign cancelled",
        processedAt: new Date(),
      },
    });
  }

  countByStatus(companyId: string, campaignId: string, status: ContactRetryJobStatus) {
    return this.prisma.contactRetryJob.count({
      where: { companyId, campaignId, status },
    });
  }

  incrementExecutionCounters(
    companyId: string,
    campaignId: string,
    data: Prisma.CampaignExecutionUpdateManyMutationInput,
  ) {
    return withPrismaWriteRetry(() =>
      this.prisma.campaignExecution.updateMany({
        where: { companyId, campaignId },
        data,
      }),
    );
  }
}

export const retryJobRepository = new RetryJobRepository(prisma);
