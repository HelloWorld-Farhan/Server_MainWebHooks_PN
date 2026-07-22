import type { CallStatus } from "@prisma/client";

import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import prisma from "@/server/lib/prisma";
import { contactCompletionService } from "@/server/campaign-execution/retry/contact-completion.service";

const DIALING_STATUSES: CallStatus[] = [
  "DISPATCHING",
  "QUEUED_AT_PROVIDER",
  "RINGING",
];
const QUEUED_STATUSES: CallStatus[] = ["PENDING", "QUEUED"];
const NO_ANSWER_STATUSES: CallStatus[] = ["NO_ANSWER", "MISSED", "VOICEMAIL"];

export class CampaignProgressService {
  private readonly lastProcessedSnapshots = new Map<
    string,
    { processedCount: number; capturedAt: number }
  >();

  async updateAllActive(): Promise<number> {
    const executions = await campaignExecutionRepository.findActiveForProgress();
    let updated = 0;

    for (const execution of executions) {
      await this.updateExecution(execution.companyId, execution.campaignId);
      if (execution.status === "RUNNING") {
        await contactCompletionService.checkCampaignCompletion(
          execution.companyId,
          execution.campaignId,
        );
      }
      updated += 1;
    }

    return updated;
  }

  async updateExecution(companyId: string, campaignId: string): Promise<void> {
    const grouped = await prisma.callLog.groupBy({
      by: ["status"],
      where: { companyId, campaignId },
      _count: { _all: true },
    });

    let statsQueued = 0;
    let statsDialing = 0;
    let statsAnswered = 0;
    let statsBusy = 0;
    let statsNoAnswer = 0;
    let statsFailed = 0;
    let statsCompleted = 0;

    for (const row of grouped) {
      const count = row._count._all;
      if (QUEUED_STATUSES.includes(row.status)) {
        statsQueued += count;
      } else if (DIALING_STATUSES.includes(row.status)) {
        statsDialing += count;
      } else if (row.status === "ANSWERED") {
        statsAnswered += count;
      } else if (row.status === "BUSY") {
        statsBusy += count;
      } else if (NO_ANSWER_STATUSES.includes(row.status)) {
        statsNoAnswer += count;
      } else if (row.status === "FAILED" || row.status === "CANCELLED") {
        statsFailed += count;
      } else if (row.status === "COMPLETED") {
        statsCompleted += count;
      }
    }

    const execution = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (!execution) {
      return;
    }

    const snapshotKey = `${companyId}:${campaignId}`;
    const now = Date.now();
    const previous = this.lastProcessedSnapshots.get(snapshotKey);
    let estimatedCompletionAt: Date | null = null;

    if (previous && execution.totalContacts > execution.processedCount) {
      const deltaProcessed = execution.processedCount - previous.processedCount;
      const deltaMs = now - previous.capturedAt;
      if (deltaProcessed > 0 && deltaMs > 0) {
        const ratePerMs = deltaProcessed / deltaMs;
        const remaining = execution.totalContacts - execution.processedCount;
        estimatedCompletionAt = new Date(now + remaining / ratePerMs);
      }
    }

    this.lastProcessedSnapshots.set(snapshotKey, {
      processedCount: execution.processedCount,
      capturedAt: now,
    });

    await campaignExecutionRepository.updateStatistics(companyId, campaignId, {
      statsQueued,
      statsDialing,
      statsAnswered,
      statsBusy,
      statsNoAnswer,
      statsFailed,
      statsCompleted,
      estimatedCompletionAt,
    });
  }

  resetSnapshotsForTests(): void {
    this.lastProcessedSnapshots.clear();
  }
}

export const campaignProgressService = new CampaignProgressService();
