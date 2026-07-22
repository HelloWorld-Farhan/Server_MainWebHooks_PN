import { Prisma } from "@prisma/client";
import type { CallStatus } from "@prisma/client";

import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import { logRetryEvent } from "@/server/campaign-execution/lib/retry-logger";
import { toCampaignPublicId } from "@/server/lib/public-id/mapper";
import prisma from "@/server/lib/prisma";

import { createSystemTenantContext } from "../lib/system-tenant-context";
import { retryConfig } from "./retry.config";
import { contactCompletionService } from "./contact-completion.service";
import { retryJobRepository } from "./retry-job.repository";
import { retryPolicyService } from "./retry-policy.service";

export type HandleTerminalCallInput = {
  companyId: string;
  callLogId: string;
  campaignId: string;
  phone?: string;
  mappedStatus: CallStatus;
  correlationId?: string;
};

export class RetrySchedulerService {
  async handleTerminalCall(input: HandleTerminalCallInput): Promise<void> {
    const { companyId, callLogId, campaignId, mappedStatus, correlationId } =
      input;

    const callLog = await prisma.callLog.findFirst({
      where: { id: callLogId, companyId },
      select: {
        retryNumber: true,
        phoneNumber: { select: { number: true } },
      },
    });
    if (!callLog) {
      return;
    }

    const phone = input.phone ?? callLog.phoneNumber?.number;
    if (!phone) {
      return;
    }

    const execution = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (!execution || execution.status !== "RUNNING") {
      return;
    }

    const policy = retryPolicyService.extractPolicy(execution);
    const currentRetryCount = await retryPolicyService.countRetriesForContact(
      companyId,
      campaignId,
      phone,
    );

    const ctx = await createSystemTenantContext(companyId);
    const campaignPublicId = await toCampaignPublicId(
      ctx,
      execution.campaign.resourceKey,
    );

    if (
      !retryPolicyService.shouldRetry(policy, mappedStatus, currentRetryCount)
    ) {
      await contactCompletionService.markContactCompleteIfDone(
        companyId,
        campaignId,
        phone,
      );
      return;
    }

    if (execution.pendingRetries >= retryConfig.maxPendingRetries) {
      logRetryEvent("retry:skipped", {
        campaignPublicId,
        phoneNumber: phone,
        retryNumber: currentRetryCount + 1,
        correlationId,
        skipReason: "max_pending_retries_cap",
        parentCallLogId: callLogId,
      });
      await contactCompletionService.markContactCompleteIfDone(
        companyId,
        campaignId,
        phone,
      );
      return;
    }

    const scheduledAt = new Date(
      Date.now() + policy.retryDelaySeconds * 1000,
    );

    try {
      await retryJobRepository.create({
        companyId,
        campaignId,
        parentCallLogId: callLogId,
        phoneNumber: phone,
        retryNumber: callLog.retryNumber + 1,
        retryReason: mappedStatus,
        correlationId: correlationId ?? execution.correlationId ?? undefined,
        scheduledAt,
      });

      await retryJobRepository.incrementExecutionCounters(
        companyId,
        campaignId,
        {
          pendingRetries: { increment: 1 },
          totalRetries: { increment: 1 },
        },
      );

      logRetryEvent("retry:scheduled", {
        campaignPublicId,
        phoneNumber: phone,
        retryNumber: callLog.retryNumber + 1,
        correlationId,
        reason: mappedStatus,
        parentCallLogId: callLogId,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        logRetryEvent("retry:skipped", {
          campaignPublicId,
          phoneNumber: phone,
          retryNumber: callLog.retryNumber + 1,
          correlationId,
          skipReason: "duplicate_parent_call_log",
          parentCallLogId: callLogId,
        });
        return;
      }
      throw error;
    }
  }
}

export const retrySchedulerService = new RetrySchedulerService();
