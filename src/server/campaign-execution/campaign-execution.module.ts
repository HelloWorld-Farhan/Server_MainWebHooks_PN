import { Module } from "@nestjs/common";

import { CampaignProgressWorker } from "@/server/campaign-execution/workers/campaign-progress.worker";
import { CampaignRunnerWorker } from "@/server/campaign-execution/workers/campaign-runner.worker";
import { CampaignSchedulerWorker } from "@/server/campaign-execution/workers/campaign-scheduler.worker";
import { RetryWorker } from "@/server/campaign-execution/workers/retry.worker";

@Module({
  providers: [
    CampaignSchedulerWorker,
    RetryWorker,
    CampaignRunnerWorker,
    CampaignProgressWorker,
  ],
})
export class CampaignExecutionModule {}
