import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";
import { campaignProgressService } from "@/server/campaign-execution/campaign-progress.service";

@Injectable()
export class CampaignProgressWorker implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    this.interval = setInterval(() => {
      void this.tick();
    }, campaignExecutionConfig.progressIntervalMs);
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
      await campaignProgressService.updateAllActive();
    } finally {
      this.processing = false;
    }
  }
}
