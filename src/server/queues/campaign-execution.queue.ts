import { Queue } from "bullmq";
import { redisConnection } from "./redis.client";

export const CAMPAIGN_EXECUTION_QUEUE_NAME = "campaign-execution-queue";

export type CampaignExecutionJobData = {
  companyId: string;
  campaignId: string;
  didNumber: string;
  leads: any[];
  channels: number;
};

export const campaignExecutionQueue = redisConnection 
  ? new Queue<CampaignExecutionJobData>(CAMPAIGN_EXECUTION_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 1, // Don't auto-retry the entire campaign loop
        removeOnComplete: true,
      },
    })
  : null;

export async function startCampaignJob(data: CampaignExecutionJobData, delayMs?: number) {
  if (!campaignExecutionQueue) {
    throw new Error("Redis not configured. Cannot start campaign.");
  }
  
  // Set initial state in Redis
  await redisConnection!.set(`campaign-state:${data.companyId}`, JSON.stringify({
    campaignId: data.campaignId,
    status: delayMs ? "scheduled" : "running",
    totalContacts: data.leads.length,
    completedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    leads: data.leads
  }));

  // Remove any existing job for this company to prevent BullMQ deduplication from blocking it
  const existingJobId = `campaign-${data.companyId}`;
  try {
    const existingJob = await campaignExecutionQueue.getJob(existingJobId);
    if (existingJob) {
      await existingJob.remove();
    }
  } catch (e) {
    console.error("Error removing existing campaign job:", e);
  }

  await campaignExecutionQueue.add(`campaign-${data.companyId}-${Date.now()}`, data, {
    jobId: existingJobId, // Ensures only 1 campaign runs per company, but we removed the old one
    delay: delayMs ? Math.max(0, delayMs) : undefined,
    removeOnComplete: true,
    removeOnFail: true
  });
}

export async function getCampaignState(companyId: string) {
  if (!redisConnection) return null;
  const state = await redisConnection.get(`campaign-state:${companyId}`);
  return state ? JSON.parse(state) : null;
}

export async function clearCampaignState(companyId: string) {
  if (!redisConnection) return;
  await redisConnection.del(`campaign-state:${companyId}`);
}
