import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { runWorkerTask } from "@/server/lib/run-worker-task";
import { retryConfig } from "@/server/campaign-execution/retry/retry.config";
import { retryWorkerService } from "@/server/campaign-execution/retry/retry-worker.service";

@Injectable()
export class RetryWorker implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    runWorkerTask("retry", () => this.tick());
    this.interval = setInterval(
      () => runWorkerTask("retry", () => this.tick()),
      retryConfig.workerIntervalMs,
    );
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
    } finally {
      this.processing = false;
    }
  }
}
