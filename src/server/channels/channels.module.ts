import { Module, OnModuleInit } from "@nestjs/common";

import {
  connectRedisOnStartup,
  isRedisDisabled,
} from "@/server/cache/redis.client";
import { ChannelQueueWorker } from "@/server/channels/channel-queue.worker";
import { ChannelReconciliationService } from "@/server/channels/channel-reconciliation.service";

@Module({
  providers: [ChannelReconciliationService, ChannelQueueWorker],
})
export class ChannelsModule implements OnModuleInit {
  constructor(
    private readonly reconciliation: ChannelReconciliationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (isRedisDisabled()) {
      console.warn(
        "[channels] REDIS_ENABLED=false; skipping Redis connect, reconcile, and queue worker gating",
      );
      return;
    }

    await connectRedisOnStartup();
    void this.reconciliation.reconcileAll().catch((error) => {
      console.error(
        "[channels] startup reconciliation failed; workers will continue with current Redis state",
        error,
      );
    });
  }
}
