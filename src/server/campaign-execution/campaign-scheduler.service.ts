import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";
import { campaignExecutionRepository } from "@/server/campaign-execution/campaign-execution.repository";
import { campaignExecutionService } from "@/server/campaign-execution/campaign-execution.service";
import { logCampaignExecutionEvent } from "@/server/campaign-execution/lib/campaign-execution-logger";

export class CampaignSchedulerService {
  async recoverOnStartup(): Promise<void> {
    const now = new Date();
    const stale = await campaignExecutionRepository.findStaleRunningLocks(now);
    for (const execution of stale) {
      logCampaignExecutionEvent("worker:restart", {
        campaignId: execution.campaignId,
        correlationId: execution.correlationId ?? undefined,
      });
    }

    await this.processDueScheduled();
  }

  async processDueScheduled(): Promise<number> {
    const now = new Date();
    const runningCount = await campaignExecutionRepository.countRunning();
    const availableSlots = Math.max(
      0,
      campaignExecutionConfig.maxConcurrentCampaigns - runningCount,
    );
    if (availableSlots === 0) {
      return 0;
    }

    const due = await campaignExecutionRepository.findDueScheduled(
      availableSlots,
      now,
    );

    let started = 0;
    for (const execution of due) {
      const promoted = await campaignExecutionService.promoteScheduledToRunning(
        execution.id,
      );
      if (promoted) {
        started += 1;
      }
    }
    return started;
  }
}

export const campaignSchedulerService = new CampaignSchedulerService();
