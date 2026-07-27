import { normalizeOutboundPhone } from "@/lib/phone-validation";
import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";
import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import { campaignExecutionService } from "@/server/campaign-execution/campaign-execution.service";
import { logCampaignExecutionEvent } from "@/server/campaign-execution/lib/campaign-execution-logger";
import { createSystemTenantContext } from "@/server/campaign-execution/lib/system-tenant-context";
import { toCampaignPublicId } from "@/server/lib/public-id/mapper";
import prisma from "@/server/lib/prisma";
import { CampaignsRepository } from "@/server/repositories/campaigns.repository";
import { outboundCallsService } from "@/server/services/outbound-calls.service";
import { campaignExecutionLockService } from "@/server/campaign-execution/campaign-execution-lock.service";
import { retryJobRepository } from "@/server/campaign-execution/retry/retry-job.repository";

export class CampaignRunnerService {
  private readonly campaignsRepo = new CampaignsRepository(prisma);
  private readonly activeCampaignIds = new Set<string>();

  getActiveCount(): number {
    return this.activeCampaignIds.size;
  }

  resetActiveForTests(): void {
    this.activeCampaignIds.clear();
  }

  async processRunnableCampaigns(): Promise<number> {
    const running = await campaignExecutionRepository.findRunningExecutions(
      campaignExecutionConfig.maxConcurrentCampaigns * 2,
    );

    let processed = 0;
    for (const execution of running) {
      if (
        this.activeCampaignIds.size >=
        campaignExecutionConfig.maxConcurrentCampaigns
      ) {
        break;
      }
      if (this.activeCampaignIds.has(execution.campaignId)) {
        continue;
      }

      const didProcess = await this.processCampaign(execution);
      if (didProcess) {
        processed += 1;
      }
    }

    return processed;
  }

  private async processCampaign(execution: {
    id: string;
    companyId: string;
    campaignId: string;
    lastProcessedContactId: string | null;
    processedCount: number;
    totalContacts: number;
    correlationId: string | null;
    campaign: { resourceKey: string };
  }): Promise<boolean> {
    const acquired = await campaignExecutionLockService.acquire(
      execution.campaignId,
      campaignExecutionConfig.workerId,
    );
    if (!acquired) {
      return false;
    }

    this.activeCampaignIds.add(execution.campaignId);

    try {
      const stillRunning = await campaignExecutionService.isRunning(
        execution.companyId,
        execution.campaignId,
      );
      if (!stillRunning) {
        return false;
      }

      const ctx = await createSystemTenantContext(execution.companyId);
      const campaignPublicId = await toCampaignPublicId(
        ctx,
        execution.campaign.resourceKey,
      );

      const contacts = await this.campaignsRepo.findContactsForExecution(
        execution.companyId,
        execution.campaignId,
        campaignExecutionConfig.batchSize,
        execution.lastProcessedContactId ?? undefined,
      );

      if (contacts.length === 0) {
        // Cursor exhausted — all contacts were already dialed/sent to VoiceNSMS.
        await this.completeIfQueueDrained(execution);
        return true;
      }

      logCampaignExecutionEvent("batch:started", {
        campaignPublicId,
        correlationId: execution.correlationId ?? undefined,
        batchSize: contacts.length,
      });

      let processedCount = execution.processedCount;

      for (const contact of contacts) {
        const running = await campaignExecutionService.isRunning(
          execution.companyId,
          execution.campaignId,
        );
        if (!running) {
          break;
        }

        const normalizedPhone = normalizeOutboundPhone(contact.phone);
        if (!normalizedPhone) {
          logCampaignExecutionEvent("contact:skipped", {
            campaignPublicId,
            correlationId: execution.correlationId ?? undefined,
            reason: "invalid_phone",
            phone: contact.phone,
          });
          processedCount += 1;
          await campaignExecutionRepository.updateCursor(
            execution.companyId,
            execution.campaignId,
            contact.id,
            processedCount,
          );
          continue;
        }

        const existingCall = await prisma.callLog.findFirst({
          where: {
            companyId: execution.companyId,
            campaignId: execution.campaignId,
            phoneNumber: { number: normalizedPhone },
          },
          orderBy: { startedAt: "desc" },
          select: { id: true, status: true },
        });

        const pendingRetries = await retryJobRepository.countPendingForPhone(
          execution.companyId,
          execution.campaignId,
          normalizedPhone,
        );

        const terminalStatuses = new Set([
          "FAILED",
          "NO_ANSWER",
          "BUSY",
          "CANCELLED",
          "MISSED",
        ]);
        const shouldDial =
          pendingRetries === 0 &&
          (!existingCall || terminalStatuses.has(existingCall.status));

        if (shouldDial) {
          await outboundCallsService.createOutboundCall(ctx, {
            campaignId: campaignPublicId,
            phoneNumber: normalizedPhone,
          });
        }

        processedCount += 1;
        await campaignExecutionRepository.updateCursor(
          execution.companyId,
          execution.campaignId,
          contact.id,
          processedCount,
        );

        await campaignExecutionLockService.renew(
          execution.campaignId,
          campaignExecutionConfig.workerId,
        );

        const lockExpiresAt = new Date(
          Date.now() + campaignExecutionConfig.lockTtlMs,
        );
        await campaignExecutionRepository.updateLock(
          execution.companyId,
          execution.campaignId,
          campaignExecutionConfig.workerId,
          lockExpiresAt,
        );
      }

      logCampaignExecutionEvent("batch:completed", {
        campaignPublicId,
        correlationId: execution.correlationId ?? undefined,
        processedCount,
      });

      // Stop as soon as the last contact has been dialed (sent to VoiceNSMS),
      // without waiting for provider webhooks / call outcomes.
      await this.completeIfQueueDrained({
        companyId: execution.companyId,
        campaignId: execution.campaignId,
        processedCount,
        totalContacts: execution.totalContacts,
      });

      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown runner error";
      await campaignExecutionService.markFailed(
        execution.companyId,
        execution.campaignId,
        message,
      );
      return true;
    } finally {
      this.activeCampaignIds.delete(execution.campaignId);
      const stillRunning = await campaignExecutionService.isRunning(
        execution.companyId,
        execution.campaignId,
      );
      if (!stillRunning) {
        await campaignExecutionLockService.release(
          execution.campaignId,
          campaignExecutionConfig.workerId,
        );
      }
    }
  }

  /**
   * When every contact has been walked by the cursor (last call sent to
   * VoiceNSMS), mark the campaign COMPLETED immediately.
   */
  private async completeIfQueueDrained(execution: {
    companyId: string;
    campaignId: string;
    processedCount: number;
    totalContacts: number;
  }): Promise<void> {
    if (execution.totalContacts <= 0) {
      return;
    }
    if (execution.processedCount < execution.totalContacts) {
      return;
    }
    await campaignExecutionService.markCompleted(
      execution.companyId,
      execution.campaignId,
    );
  }
}

export const campaignRunnerService = new CampaignRunnerService();
