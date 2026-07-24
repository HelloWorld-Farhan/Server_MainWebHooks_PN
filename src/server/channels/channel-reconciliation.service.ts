import { Injectable } from "@nestjs/common";
import type { CallStatus } from "@prisma/client";

import { channelService } from "@/server/channels/channel.service";
import { logChannelEvent } from "@/server/channels/channel-metrics";
import { gqlDebug } from "@/server/graphql/debug";
import prisma from "@/server/lib/prisma";
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
 * QUEUED_AT_PROVIDER with no terminal webhook older than this is failed
 * so the channel slot can be freed.
 */
export const STALE_QUEUED_AT_PROVIDER_MS = 30 * 60 * 1000;

@Injectable()
export class ChannelReconciliationService {
  private readonly callLogsRepo = new CallLogsRepository(prisma);

  async reconcileAll(): Promise<void> {
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
      now - STALE_QUEUED_AT_PROVIDER_MS,
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
