import type { CallStatus } from "@prisma/client";

import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import prisma from "@/server/lib/prisma";

import { retryJobRepository } from "./retry-job.repository";
import { retryPolicyService, type RetryPolicyFields } from "./retry-policy.service";

export type CampaignRetryStatistics = {
  totalCalls: number;
  initialCalls: number;
  retryCalls: number;
  retrySuccessRate: number;
  averageRetryCount: number;
  busy: number;
  noAnswer: number;
  failed: number;
  answered: number;
  completed: number;
  pendingRetries: number;
};

export type CampaignRetryPolicyView = RetryPolicyFields;

export type ContactRetryHistoryEntry = {
  retryNumber: number;
  createdAt: string;
  reason: CallStatus;
  callLogId: string | null;
  status: string;
  jobStatus: string;
};

export type CampaignRetrySummary = {
  policy: CampaignRetryPolicyView;
  statistics: CampaignRetryStatistics;
  pendingRetries: number;
  totalRetries: number;
  completedRetries: number;
  failedRetries: number;
};

const NO_ANSWER_STATUSES: CallStatus[] = ["NO_ANSWER", "MISSED", "VOICEMAIL"];

export class RetryStatisticsService {
  async getPolicy(
    companyId: string,
    campaignId: string,
  ): Promise<CampaignRetryPolicyView | null> {
    const execution = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (!execution) {
      return null;
    }
    return retryPolicyService.extractPolicy(execution);
  }

  async getStatistics(
    companyId: string,
    campaignId: string,
  ): Promise<CampaignRetryStatistics> {
    const [initialCalls, retryCalls, grouped, pendingRetries] =
      await Promise.all([
        prisma.callLog.count({
          where: { companyId, campaignId, isRetry: false },
        }),
        prisma.callLog.count({
          where: { companyId, campaignId, isRetry: true },
        }),
        prisma.callLog.groupBy({
          by: ["status"],
          where: { companyId, campaignId },
          _count: { _all: true },
        }),
        retryJobRepository.countByStatus(companyId, campaignId, "PENDING"),
      ]);

    const totalCalls = initialCalls + retryCalls;

    let busy = 0;
    let noAnswer = 0;
    let failed = 0;
    let answered = 0;
    let completed = 0;

    for (const row of grouped) {
      const count = row._count._all;
      if (row.status === "BUSY") {
        busy += count;
      } else if (NO_ANSWER_STATUSES.includes(row.status)) {
        noAnswer += count;
      } else if (row.status === "FAILED" || row.status === "CANCELLED") {
        failed += count;
      } else if (row.status === "ANSWERED") {
        answered += count;
      } else if (row.status === "COMPLETED") {
        completed += count;
      }
    }

    const retrySuccessCount = await prisma.callLog.count({
      where: {
        companyId,
        campaignId,
        isRetry: true,
        status: { in: ["ANSWERED", "COMPLETED"] },
      },
    });

    const retrySuccessRate =
      retryCalls > 0 ? retrySuccessCount / retryCalls : 0;

    const contactsWithRetries = await prisma.callLog.groupBy({
      by: ["phoneNumberId"],
      where: { companyId, campaignId, isRetry: true, phoneNumberId: { not: null } },
      _count: { _all: true },
    });

    const averageRetryCount =
      contactsWithRetries.length > 0
        ? contactsWithRetries.reduce((sum, row) => sum + row._count._all, 0) /
          contactsWithRetries.length
        : 0;

    return {
      totalCalls,
      initialCalls,
      retryCalls,
      retrySuccessRate,
      averageRetryCount,
      busy,
      noAnswer,
      failed,
      answered,
      completed,
      pendingRetries,
    };
  }

  async getHistory(
    companyId: string,
    campaignId: string,
    phoneNumber?: string,
  ): Promise<ContactRetryHistoryEntry[]> {
    const jobs = await retryJobRepository.findHistoryForCampaign(
      companyId,
      campaignId,
      phoneNumber,
    );

    const entries: ContactRetryHistoryEntry[] = [];

    for (const job of jobs) {
      let callLogPublicId: string | null = null;
      let callStatus = "SCHEDULED";

      if (job.createdCallLogId) {
        const callLog = await prisma.callLog.findFirst({
          where: { id: job.createdCallLogId, companyId },
          select: { publicId: true, status: true },
        });
        callLogPublicId = callLog?.publicId ?? null;
        callStatus = callLog?.status ?? "UNKNOWN";
      }

      entries.push({
        retryNumber: job.retryNumber,
        createdAt: job.createdAt.toISOString(),
        reason: job.retryReason,
        callLogId: callLogPublicId,
        status: callStatus,
        jobStatus: job.status,
      });
    }

    return entries;
  }

  async getPendingRetries(companyId: string, campaignId: string) {
    const jobs = await retryJobRepository.findPendingForCampaign(
      companyId,
      campaignId,
    );

    return jobs.map((job) => ({
      id: job.id,
      phoneNumber: job.phoneNumber,
      retryNumber: job.retryNumber,
      retryReason: job.retryReason,
      scheduledAt: job.scheduledAt.toISOString(),
      status: job.status,
      correlationId: job.correlationId,
    }));
  }

  async getSummary(
    companyId: string,
    campaignId: string,
  ): Promise<CampaignRetrySummary | null> {
    const execution = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (!execution) {
      return null;
    }

    const [statistics, pending] = await Promise.all([
      this.getStatistics(companyId, campaignId),
      this.getPendingRetries(companyId, campaignId),
    ]);

    return {
      policy: retryPolicyService.extractPolicy(execution),
      statistics,
      pendingRetries: pending.length,
      totalRetries: execution.totalRetries,
      completedRetries: execution.completedRetries,
      failedRetries: execution.failedRetries,
    };
  }
}

export const retryStatisticsService = new RetryStatisticsService();
