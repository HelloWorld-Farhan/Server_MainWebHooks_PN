const fs = require('fs');
let content = fs.readFileSync('src/server/queues/campaign-execution.worker.ts', 'utf8');

// 1. Add REACTIVATION import
content = content.replace(
  'import { CAMPAIGN_EXECUTION_QUEUE_NAME, CampaignExecutionJobData, campaignExecutionQueue } from "./campaign-execution.queue";',
  'import { CAMPAIGN_EXECUTION_QUEUE_NAME, REACTIVATION_EXECUTION_QUEUE_NAME, CampaignExecutionJobData, campaignExecutionQueue, reactivationExecutionQueue } from "./campaign-execution.queue";'
);

// 2. Wrap into processCampaignJob
content = content.replace(
  /export const campaignExecutionWorker = redisConnection\s*\?\s*new Worker<CampaignExecutionJobData>\(\s*CAMPAIGN_EXECUTION_QUEUE_NAME,\s*async \(job: Job<CampaignExecutionJobData>\) => \{/,
  \const processCampaignJob = async (job: Job<CampaignExecutionJobData>) => {
        const redisKey = job.data.isReactivation ? \\\campaign-state:reactivation:\\\\ : \\\campaign-state:live:\\\\;\
);

// 3. Replace all \campaign-state:\\ with redisKey
// Note: we want to replace backticked strings exactly
content = content.replace(/\\\campaign-state:\\\$\\{companyId\\}\\\/g, 'redisKey');

// 4. Update the Phase 3 Priority Engine Auto-Resume logic
const oldPhase3 = \// PHASE 3: PRIORITY ENGINE AUTO-RESUME
          // -------------------------------------------------------------
          try {
            const pausedStateStr = await redisConnection!.get(\\\campaign-state:paused:\\\\);
            if (pausedStateStr) {
              const pausedState = JSON.parse(pausedStateStr);
              if (!job.data.isReactivation) {
                 console.log(\\\[Traffic Cop] Live Campaign finished. Auto-resuming Reactivation for company \\\\);
                 const resumedState = { ...pausedState, status: "running" };
                 await redisConnection!.set(\\\campaign-state:\\\\, JSON.stringify(resumedState));
                 await redisConnection!.del(\\\campaign-state:paused:\\\\);
                 const gateway = CampaignGateway.getInstance();
                 if (gateway) gateway.broadcastCampaignUpdate(companyId, resumedState);
              }
            } else {\;

const newPhase3 = \// PHASE 3: PRIORITY ENGINE AUTO-RESUME
          // -------------------------------------------------------------
          try {
            if (!job.data.isReactivation) {
              const reactStateStr = await redisConnection!.get(\\\campaign-state:reactivation:\\\\);
              if (reactStateStr) {
                const reactState = JSON.parse(reactStateStr);
                if (reactState.status === "paused") {
                   console.log(\\\[Traffic Cop] Live Campaign finished. Auto-resuming Reactivation for company \\\\);
                   const resumedState = { ...reactState, status: "running" };
                   await redisConnection!.set(\\\campaign-state:reactivation:\\\\, JSON.stringify(resumedState));
                   const gateway = CampaignGateway.getInstance();
                   if (gateway) gateway.broadcastCampaignUpdate(companyId, resumedState);
                }
              }
            } else {\;

content = content.replace(oldPhase3, newPhase3);

// 5. Replace the end of the worker definition
const endWorker = \      },
      {
        connection: redisConnection,
        concurrency: 5,
      }
    )
  : null;\;

const newEndWorker = \};

export const campaignExecutionWorker = redisConnection
  ? new Worker<CampaignExecutionJobData>(
      CAMPAIGN_EXECUTION_QUEUE_NAME,
      processCampaignJob,
      { connection: redisConnection, concurrency: 5 }
    )
  : null;

export const reactivationExecutionWorker = redisConnection
  ? new Worker<CampaignExecutionJobData>(
      REACTIVATION_EXECUTION_QUEUE_NAME,
      processCampaignJob,
      { connection: redisConnection, concurrency: 5 }
    )
  : null;\;

content = content.replace(endWorker, newEndWorker);

fs.writeFileSync('src/server/queues/campaign-execution.worker.ts', content);
console.log('Refactor complete!');
