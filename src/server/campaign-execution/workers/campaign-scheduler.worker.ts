import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";
import { campaignSchedulerService } from "@/server/campaign-execution/campaign-scheduler.service";

@Injectable()
export class CampaignSchedulerWorker implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    void campaignSchedulerService.recoverOnStartup();
    this.interval = setInterval(() => {
      void this.tick();
    }, campaignExecutionConfig.schedulerIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async tick(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      await campaignSchedulerService.processDueScheduled();
    } finally {
      this.processing = false;
    }
  }
}
