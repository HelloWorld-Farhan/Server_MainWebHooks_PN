import type { CallStatus } from "@prisma/client";

import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import { campaignExecutionService } from "@/server/campaign-execution/campaign-execution.service";
import prisma from "@/server/lib/prisma";
import { isTerminalCallStatus } from "@/server/telephony/call-status-lifecycle";
import { CampaignsRepository } from "@/server/repositories/campaigns.repository";

import { retryJobRepository } from "./retry-job.repository";
import {
  retryPolicyService,
  type RetryPolicyFields,
} from "./retry-policy.service";

const SUCCESS_STATUSES: ReadonlySet<CallStatus> = new Set([
  "ANSWERED",
  "COMPLETED",
]);

const NON_TERMINAL_STATUSES: CallStatus[] = [
  "PENDING",
  "QUEUED",
  "DISPATCHING",
  "QUEUED_AT_PROVIDER",
  "RINGING",
  "ANSWERED",
];

export class ContactCompletionService {
  private readonly campaignsRepo = new CampaignsRepository(prisma);

  async isContactComplete(
    companyId: string,
    campaignId: string,
    phone: string,
    policy?: RetryPolicyFields,
  ): Promise<boolean> {
    const execution =
      policy ??
      (await campaignExecutionRepository.findByCampaignId(companyId, campaignId));
    if (!execution) {
      return false;
    }

    const resolvedPolicy = retryPolicyService.extractPolicy(execution);

    const pendingRetries = await retryJobRepository.countPendingForPhone(
      companyId,
      campaignId,
      phone,
    );
    if (pendingRetries > 0) {
      return false;
    }

    const inFlight = await prisma.callLog.count({
      where: {
        companyId,
        campaignId,
        phoneNumber: { number: phone },
        status: { in: NON_TERMINAL_STATUSES.filter((s) => s !== "ANSWERED") },
      },
    });
    if (inFlight > 0) {
      return false;
    }

    const latestCall = await prisma.callLog.findFirst({
      where: {
        companyId,
        campaignId,
        phoneNumber: { number: phone },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true, isRetry: true },
    });

    if (!latestCall) {
      return false;
    }

    if (!isTerminalCallStatus(latestCall.status)) {
      return false;
    }

    if (SUCCESS_STATUSES.has(latestCall.status)) {
      return true;
    }

    if (!resolvedPolicy.retryEnabled) {
      return true;
    }

    const retryCount = await retryPolicyService.countRetriesForContact(
      companyId,
      campaignId,
      phone,
    );

    if (retryCount >= resolvedPolicy.maxRetries) {
      return true;
    }

    return false;
  }

  async reconcileCompletedContactsCount(
    companyId: string,
    campaignId: string,
  ): Promise<number> {
    const execution = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (!execution) {
      return 0;
    }

    const contacts = await this.campaignsRepo.findContactsForExecution(
      companyId,
      campaignId,
      execution.totalContacts || 100_000,
    );

    let completed = 0;
    for (const contact of contacts) {
      if (
        await this.isContactComplete(companyId, campaignId, contact.phone)
      ) {
        completed += 1;
      }
    }

    if (completed !== execution.completedContactsCount) {
      await campaignExecutionRepository.updateStatistics(companyId, campaignId, {
        completedContactsCount: completed,
      });
    }

    return completed;
  }

  async markContactCompleteIfDone(
    companyId: string,
    campaignId: string,
    phone: string,
  ): Promise<void> {
    await this.reconcileCompletedContactsCount(companyId, campaignId);
    await this.checkCampaignCompletion(companyId, campaignId);
  }

  async checkCampaignCompletion(
    companyId: string,
    campaignId: string,
  ): Promise<boolean> {
    const execution = await campaignExecutionRepository.findByCampaignId(
      companyId,
      campaignId,
    );
    if (!execution || execution.status !== "RUNNING") {
      return false;
    }

    if (execution.processedCount < execution.totalContacts) {
      return false;
    }

    const pendingRetries = await retryJobRepository.countByStatus(
      companyId,
      campaignId,
      "PENDING",
    );
    const processingRetries = await retryJobRepository.countByStatus(
      companyId,
      campaignId,
      "PROCESSING",
    );
    if (pendingRetries > 0 || processingRetries > 0) {
      return false;
    }

    const inFlightCalls = await prisma.callLog.count({
      where: {
        companyId,
        campaignId,
        status: { in: NON_TERMINAL_STATUSES },
      },
    });
    if (inFlightCalls > 0) {
      return false;
    }

    const completedCount = await this.reconcileCompletedContactsCount(
      companyId,
      campaignId,
    );

    if (completedCount < execution.totalContacts) {
      return false;
    }

    await campaignExecutionService.markCompleted(companyId, campaignId);
    return true;
  }
}

export const contactCompletionService = new ContactCompletionService();
