import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { CallStatus } from "@prisma/client";

import { isRedisDisabled } from "@/server/cache/redis.client";
import {
  getChannelReconcilePollMs,
  getStaleQueuedAtProviderMs,
} from "@/server/channels/channel-keys";
import { wakeCompanyQueue } from "@/server/channels/channel-queue.hooks";
import { channelService } from "@/server/channels/channel.service";
import { logChannelEvent } from "@/server/channels/channel-metrics";
import { gqlDebug } from "@/server/graphql/debug";
import prisma from "@/server/lib/prisma";
import { runWorkerTask } from "@/server/lib/run-worker-task";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";

const ACTIVE_CHANNEL_STATUSES: CallStatus[] = [
  "DISPATCHING",
  "QUEUED_AT_PROVIDER",
  "RINGING",
  "ANSWERED",
];

/** DISPATCHING older than this is treated as a failed mid-dispatch. */
export const STALE_DISPATCHING_MS = 2 * 60 * 1000;

/**
 * @deprecated Prefer getStaleQueuedAtProviderMs() so env overrides apply.
 * Kept for tests/scripts that import the constant.
 */
export const STALE_QUEUED_AT_PROVIDER_MS = 2 * 60 * 1000;

@Injectable()
export class ChannelReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly callLogsRepo = new CallLogsRepository(prisma);
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  onModuleInit(): void {
    if (isRedisDisabled()) {
      return;
    }

    this.interval = setInterval(() => {
      runWorkerTask("channel-reconcile", () => this.reconcileAll());
    }, getChannelReconcilePollMs());
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async reconcileAll(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      await this.runReconcile();
    } finally {
      this.processing = false;
    }
  }

  private async runReconcile(): Promise<void> {
    const companies = await prisma.company.findMany({
      where: {
        setupConfig: {
          is: {
            totalChannels: { gt: 0 },
          },
        },
      },
      select: {
        id: true,
        setupConfig: {
          select: { totalChannels: true },
        },
      },
    });

    const now = Date.now();
    const staleDispatchingBefore = new Date(now - STALE_DISPATCHING_MS);
    const staleQueuedAtProviderBefore = new Date(
      now - getStaleQueuedAtProviderMs(),
    );

    for (const company of companies) {
      const allocated = company.setupConfig?.totalChannels ?? 0;

      const staleDispatching = await this.callLogsRepo.failStaleDispatching(
        company.id,
        staleDispatchingBefore,
      );
      const staleQueuedAtProvider =
        await this.callLogsRepo.failStaleQueuedAtProvider(
          company.id,
          staleQueuedAtProviderBefore,
        );

      if (
        staleDispatching.count > 0 ||
        staleQueuedAtProvider.count > 0
      ) {
        logChannelEvent("channels:reconcile:stale-cleanup", {
          companyId: company.id,
          failedDispatching: staleDispatching.count,
          failedQueuedAtProvider: staleQueuedAtProvider.count,
        });
      }

      const active = await this.callLogsRepo.countByStatuses(
        company.id,
        ACTIVE_CHANNEL_STATUSES,
      );
      const queued = await this.callLogsRepo.findQueuedCallLogIds(company.id);

      await channelService.initializeCompany(
        company.id,
        allocated,
        active,
        queued,
      );

      const metrics = await channelService.getMetrics(company.id);
      if (metrics.available > 0 && metrics.queueLength > 0) {
        wakeCompanyQueue(company.id);
      }

      gqlDebug("channels:reconcile:company", {
        companyId: company.id,
        allocated,
        active,
        queuedCount: queued.length,
      });
    }

    logChannelEvent("channels:reconcile:complete", {
      companyCount: companies.length,
    });
  }
}
