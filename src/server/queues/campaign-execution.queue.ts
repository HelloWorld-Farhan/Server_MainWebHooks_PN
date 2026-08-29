import { Queue } from "bullmq";
import { redisConnection } from "./redis.client";
import { CampaignGateway } from "@/modules/websockets/campaign.gateway";

export const CAMPAIGN_EXECUTION_QUEUE_NAME = "campaign-execution-queue";

export type CampaignExecutionJobData = {
  companyId: string;
  campaignId: string;
  didNumber: string;
  leads: any[];
  channels: number;
  isReactivation?: boolean;
  scheduledAt?: string;
  uploadedFileName?: string;
};

export const campaignExecutionQueue = redisConnection 
  ? new Queue<CampaignExecutionJobData>(CAMPAIGN_EXECUTION_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 1, // Don't auto-retry the entire campaign loop
        removeOnComplete: true,
        removeOnFail: true,
      },
    })
  : null;

export async function startCampaignJob(data: CampaignExecutionJobData, delayMs?: number) {
  if (!campaignExecutionQueue) {
    throw new Error("Redis not configured. Cannot start campaign.");
  }
  
  const existingJobId = `campaign-${data.companyId}`;
  try {
    const existingJob = await campaignExecutionQueue.getJob(existingJobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "active" || state === "waiting" || state === "delayed") {
        throw new Error("A campaign is already running or scheduled for this company.");
      }
      await existingJob.remove();
    }
  } catch (e: any) {
    if (e.message.includes("already running")) {
      throw e;
    }
    console.error("Error checking existing campaign job:", e);
  }

  // Deduplicate leads by phone to prevent multiple calls to the same number
  const uniqueLeadsMap = new Map();
  for (const lead of data.leads) {
    if (lead?.phone) {
      const corePhone = lead.phone.replace(/\D/g, "").slice(-10);
      uniqueLeadsMap.set(corePhone, lead);
    }
  }
  const deduplicatedLeads = Array.from(uniqueLeadsMap.values());
  data.leads = deduplicatedLeads;

  // Set initial state in Redis
  const initialState = {
    campaignId: data.campaignId,
    status: delayMs ? "scheduled" : "running",
    totalContacts: data.leads.length,
    completedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    leads: data.leads,
    isReactivation: !!data.isReactivation,
    scheduledAt: delayMs ? data.scheduledAt : undefined,
    uploadedFileName: data.uploadedFileName
  };
  await redisConnection!.set(`campaign-state:${data.companyId}`, JSON.stringify(initialState));

  // Broadcast WebSocket event so UI instantly updates to Scheduled/Running
  const gateway = CampaignGateway.getInstance();
  if (gateway) {
    gateway.broadcastCampaignUpdate(data.companyId, initialState);
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
