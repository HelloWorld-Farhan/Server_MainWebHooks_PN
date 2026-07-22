import { Module, OnModuleInit } from "@nestjs/common";

import { connectRedisOnStartup } from "@/server/cache/redis.client";
import { ChannelQueueWorker } from "@/server/channels/channel-queue.worker";
import { ChannelReconciliationService } from "@/server/channels/channel-reconciliation.service";

@Module({
  providers: [ChannelReconciliationService, ChannelQueueWorker],
})
export class ChannelsModule implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await connectRedisOnStartup();
  }
}
