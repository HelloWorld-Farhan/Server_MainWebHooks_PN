import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  getChannelCooldownMs,
  getChannelQueuePollMs,
} from "@/server/channels/channel-keys";
import { channelService } from "@/server/channels/channel.service";
import { callService } from "@/server/services/call.service";
import { runWorkerTask } from "@/server/lib/run-worker-task";

@Injectable()
export class ChannelQueueWorker implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    this.interval = setInterval(() => {
      runWorkerTask("channel-queue", () => this.tick());
    }, getChannelQueuePollMs());
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
      const releases = await channelService.drainExpiredCooldowns();
      const companies = new Set(releases.map((entry) => entry.companyId));

      for (const release of releases) {
        await channelService.release(release.companyId);
        companies.add(release.companyId);
      }

      for (const companyId of companies) {
        await this.processCompanyQueue(companyId);
      }
    } finally {
      this.processing = false;
    }
  }

  async processCompanyQueue(companyId: string): Promise<void> {
    const metrics = await channelService.getMetrics(companyId);
    if (metrics.allocated <= 0) {
      return;
    }

    while (true) {
      const reserved = await channelService.tryReserve(companyId);
      if (!reserved) {
        break;
      }

      const callLogId = await channelService.dequeue(companyId);
      if (!callLogId) {
        await channelService.release(companyId);
        break;
      }

      const dispatched = await callService.dispatchQueuedCall(callLogId);
      if (!dispatched) {
        await channelService.release(companyId);
        break;
      }
    }
  }
}

export { getChannelCooldownMs, getChannelQueuePollMs };
