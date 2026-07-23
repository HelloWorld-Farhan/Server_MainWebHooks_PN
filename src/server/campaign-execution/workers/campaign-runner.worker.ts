import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";
import { campaignRunnerService } from "@/server/campaign-execution/campaign-runner.service";
import { runWorkerTask } from "@/server/lib/run-worker-task";
import { retryWorkerService } from "@/server/campaign-execution/retry/retry-worker.service";

@Injectable()
export class CampaignRunnerWorker implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    this.interval = setInterval(() => {
      runWorkerTask("campaign-runner", () => this.tick());
    }, campaignExecutionConfig.runnerIntervalMs);
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
      await retryWorkerService.processDueRetries();
      await campaignRunnerService.processRunnableCampaigns();
    } finally {
      this.processing = false;
    }
  }
}
