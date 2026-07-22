import type { CallStatus } from "@prisma/client";

import prisma from "@/server/lib/prisma";

const RETRIABLE_STATUSES: ReadonlySet<CallStatus> = new Set([
  "FAILED",
  "BUSY",
  "NO_ANSWER",
  "CANCELLED",
  "MISSED",
  "VOICEMAIL",
]);

const NON_RETRIABLE_STATUSES: ReadonlySet<CallStatus> = new Set([
  "ANSWERED",
  "COMPLETED",
]);

export type RetryPolicyFields = {
  retryEnabled: boolean;
  maxRetries: number;
  retryDelaySeconds: number;
  retryOnBusy: boolean;
  retryOnNoAnswer: boolean;
  retryOnFailed: boolean;
  retryOnCancelled: boolean;
  retryOnVoicemail: boolean;
  retryOnMissed: boolean;
};

export class RetryPolicyService {
  isRetriableStatus(status: CallStatus): boolean {
    if (NON_RETRIABLE_STATUSES.has(status)) {
      return false;
    }
    return RETRIABLE_STATUSES.has(status);
  }

  isStatusEnabledByPolicy(
    status: CallStatus,
    policy: RetryPolicyFields,
  ): boolean {
    switch (status) {
      case "BUSY":
        return policy.retryOnBusy;
      case "NO_ANSWER":
        return policy.retryOnNoAnswer;
      case "FAILED":
        return policy.retryOnFailed;
      case "CANCELLED":
        return policy.retryOnCancelled;
      case "VOICEMAIL":
        return policy.retryOnVoicemail;
      case "MISSED":
        return policy.retryOnMissed;
      default:
        return false;
    }
  }

  shouldRetry(
    policy: RetryPolicyFields,
    status: CallStatus,
    currentRetryCount: number,
  ): boolean {
    if (!policy.retryEnabled) {
      return false;
    }
    if (!this.isRetriableStatus(status)) {
      return false;
    }
    if (!this.isStatusEnabledByPolicy(status, policy)) {
      return false;
    }
    if (currentRetryCount >= policy.maxRetries) {
      return false;
    }
    return true;
  }

  async countRetriesForContact(
    companyId: string,
    campaignId: string,
    phone: string,
  ): Promise<number> {
    return prisma.callLog.count({
      where: {
        companyId,
        campaignId,
        isRetry: true,
        phoneNumber: { number: phone },
      },
    });
  }

  extractPolicy(execution: RetryPolicyFields): RetryPolicyFields {
    return {
      retryEnabled: execution.retryEnabled,
      maxRetries: execution.maxRetries,
      retryDelaySeconds: execution.retryDelaySeconds,
      retryOnBusy: execution.retryOnBusy,
      retryOnNoAnswer: execution.retryOnNoAnswer,
      retryOnFailed: execution.retryOnFailed,
      retryOnCancelled: execution.retryOnCancelled,
      retryOnVoicemail: execution.retryOnVoicemail,
      retryOnMissed: execution.retryOnMissed,
    };
  }
}

export const retryPolicyService = new RetryPolicyService();
