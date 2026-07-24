import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  getChannelCooldownMs,
  getChannelQueuePollMs,
} from "@/server/channels/channel-keys";
import { drainCompanyQueue } from "@/server/channels/channel-queue.drain";
import { registerCompanyQueueWake } from "@/server/channels/channel-queue.hooks";
import { channelService } from "@/server/channels/channel.service";
import prisma from "@/server/lib/prisma";
import { runWorkerTask } from "@/server/lib/run-worker-task";

export { drainCompanyQueue } from "@/server/channels/channel-queue.drain";

@Injectable()
export class ChannelQueueWorker implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    registerCompanyQueueWake(drainCompanyQueue);
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

      const companiesWithChannels = await prisma.company.findMany({
        where: {
          setupConfig: {
            is: {
              totalChannels: { gt: 0 },
            },
          },
        },
        select: { id: true },
      });

      const pending = await channelService.listCompaniesWithPendingWork(
        companiesWithChannels.map((company) => company.id),
      );
      for (const companyId of pending) {
        companies.add(companyId);
      }

      for (const companyId of companies) {
        await this.processCompanyQueue(companyId);
      }
    } finally {
      this.processing = false;
    }
  }

  async processCompanyQueue(companyId: string): Promise<void> {
    await drainCompanyQueue(companyId);
  }
}

export { getChannelCooldownMs, getChannelQueuePollMs };
