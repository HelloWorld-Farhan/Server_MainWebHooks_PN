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

    for (const company of companies) {
      const allocated = company.setupConfig?.totalChannels ?? 0;
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
