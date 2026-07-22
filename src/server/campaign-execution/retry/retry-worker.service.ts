import type { CallStatus } from "@prisma/client";

import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import { logRetryEvent } from "@/server/campaign-execution/lib/retry-logger";
import { toCampaignPublicId } from "@/server/lib/public-id/mapper";
import prisma from "@/server/lib/prisma";
import { outboundCallsService } from "@/server/services/outbound-calls.service";
import { isTerminalCallStatus } from "@/server/telephony/call-status-lifecycle";

import { createSystemTenantContext } from "../lib/system-tenant-context";
import { retryConfig } from "./retry.config";
import { contactCompletionService } from "./contact-completion.service";
import { retryJobRepository } from "./retry-job.repository";
import { retryPolicyService } from "./retry-policy.service";

export class RetryWorkerService {
  async processDueRetries(limit = retryConfig.processBatchSize): Promise<number> {
    const now = new Date();
    const jobs = await retryJobRepository.findDuePending(limit, now);
    let processed = 0;

    for (const job of jobs) {
      const didProcess = await this.processJob(job.id);
      if (didProcess) {
        processed += 1;
      }
    }

    return processed;
  }

  private async processJob(jobId: string): Promise<boolean> {
    const claimed = await retryJobRepository.claimJob(jobId);
    if (claimed.count === 0) {
      return false;
    }

    const job = await prisma.contactRetryJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return false;
    }

    const execution = await campaignExecutionRepository.findByCampaignId(
      job.companyId,
      job.campaignId,
    );

    const ctx = await createSystemTenantContext(job.companyId);
    const campaignPublicId = execution
      ? await toCampaignPublicId(ctx, execution.campaign.resourceKey)
      : undefined;

    logRetryEvent("retry:started", {
      campaignPublicId,
      phoneNumber: job.phoneNumber,
      retryNumber: job.retryNumber,
      correlationId: job.correlationId ?? undefined,
      parentCallLogId: job.parentCallLogId,
    });

    if (!execution || execution.status !== "RUNNING") {
      await this.skipJob(job, "campaign_not_running", campaignPublicId);
      return true;
    }

    const parentCall = await prisma.callLog.findFirst({
      where: { id: job.parentCallLogId, companyId: job.companyId },
      select: { status: true, retryNumber: true },
    });

    if (!parentCall || !isTerminalCallStatus(parentCall.status)) {
      await this.skipJob(job, "parent_call_not_terminal", campaignPublicId);
      return true;
    }

    if (job.createdCallLogId) {
      await this.skipJob(job, "retry_already_executed", campaignPublicId);
      return true;
    }

    const policy = retryPolicyService.extractPolicy(execution);
    const currentRetryCount = await retryPolicyService.countRetriesForContact(
      job.companyId,
      job.campaignId,
      job.phoneNumber,
    );

    if (
      !retryPolicyService.shouldRetry(
        policy,
        job.retryReason as CallStatus,
        currentRetryCount,
      )
    ) {
      await this.skipJob(job, "retry_no_longer_eligible", campaignPublicId);
      await contactCompletionService.markContactCompleteIfDone(
        job.companyId,
        job.campaignId,
        job.phoneNumber,
      );
      return true;
    }

    try {
      const result = await outboundCallsService.createRetryOutboundCall(ctx, {
        campaignId: campaignPublicId!,
        phoneNumber: job.phoneNumber,
        parentCallLogId: job.parentCallLogId,
        retryNumber: job.retryNumber,
        retryReason: job.retryReason,
        correlationId: job.correlationId ?? undefined,
      });

      const createdCallLog = await prisma.callLog.findFirst({
        where: { companyId: job.companyId, publicId: result.callLogId },
        select: { id: true },
      });

      await retryJobRepository.completeJob(job.id, {
        createdCallLogId: createdCallLog?.id ?? job.parentCallLogId,
        processedAt: new Date(),
      });

      await retryJobRepository.incrementExecutionCounters(
        job.companyId,
        job.campaignId,
        {
          pendingRetries: { decrement: 1 },
          completedRetries: { increment: 1 },
        },
      );

      logRetryEvent("retry:completed", {
        campaignPublicId,
        phoneNumber: job.phoneNumber,
        retryNumber: job.retryNumber,
        correlationId: job.correlationId ?? undefined,
        parentCallLogId: job.parentCallLogId,
        createdCallLogId: result.callLogId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown retry error";

      await retryJobRepository.failJob(job.id, message);
      await retryJobRepository.incrementExecutionCounters(
        job.companyId,
        job.campaignId,
        {
          pendingRetries: { decrement: 1 },
          failedRetries: { increment: 1 },
        },
      );

      logRetryEvent("retry:failed", {
        campaignPublicId,
        phoneNumber: job.phoneNumber,
        retryNumber: job.retryNumber,
        correlationId: job.correlationId ?? undefined,
        parentCallLogId: job.parentCallLogId,
        error: message,
      });

      await contactCompletionService.markContactCompleteIfDone(
        job.companyId,
        job.campaignId,
        job.phoneNumber,
      );
    }

    return true;
  }

  private async skipJob(
    job: { id: string; companyId: string; campaignId: string; phoneNumber: string; retryNumber: number; correlationId: string | null; parentCallLogId: string },
    skipReason: string,
    campaignPublicId?: string,
  ): Promise<void> {
    await retryJobRepository.skipJob(job.id, skipReason);
    await retryJobRepository.incrementExecutionCounters(
      job.companyId,
      job.campaignId,
      {
        pendingRetries: { decrement: 1 },
      },
    );

    logRetryEvent("retry:skipped", {
      campaignPublicId,
      phoneNumber: job.phoneNumber,
      retryNumber: job.retryNumber,
      correlationId: job.correlationId ?? undefined,
      skipReason,
      parentCallLogId: job.parentCallLogId,
    });
  }
}

export const retryWorkerService = new RetryWorkerService();
