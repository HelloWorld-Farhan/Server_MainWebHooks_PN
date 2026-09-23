import { Queue } from "bullmq";
import { redisConnection } from "./redis.client";
import { CampaignGateway } from "@/modules/websockets/campaign.gateway";
import prisma from "@/server/lib/prisma";

export const CAMPAIGN_EXECUTION_QUEUE_NAME = "campaign-execution-queue";
export const REACTIVATION_EXECUTION_QUEUE_NAME = "reactivation-execution-queue";

export function buildReactivationCorrelationId(
  dateStr: string,   // "2026-09-17"
  companyId: string,
  didNumber: string,
  stage: "q1" | "q2" | "q3"
): string {
  const compShort = companyId.replace(/-/g, "").slice(0, 8);
  const didDigits = didNumber.replace(/\D/g, "").slice(-6);
  return `reactivation-${dateStr}-${compShort}-${didDigits}-${stage}`;
}

export type CampaignExecutionJobData = {
  companyId: string;
  campaignId: string;
  didNumber: string;
  leads: any[];
  channels: number;
  isReactivation?: boolean;
  qStage?: "Q1" | "Q2" | "Q3";
  scheduledAt?: string;
  uploadedFileName?: string;
  /** Stable date key (YYYY-MM-DD) so wave chaining can build the correct correlationId */
  reactivationDateKey?: string;
  /** Full original lead list carried through all waves for filtering */
  allOriginalLeads?: any[];
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

export const reactivationExecutionQueue = redisConnection 
  ? new Queue<CampaignExecutionJobData>(REACTIVATION_EXECUTION_QUEUE_NAME, {
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
  
  // We use a unique Job ID so multiple schedules can coexist without overwriting each other
  const uniqueJobId = `campaign-${data.companyId}-${data.qStage || 'new'}-${Date.now()}`;
  
  // Determine the correct state key and queue based on campaign type
  const redisKey = data.isReactivation 
    ? `campaign-state:reactivation:${data.companyId}` 
    : `campaign-state:live:${data.companyId}`;
  const targetQueue = data.isReactivation ? reactivationExecutionQueue : campaignExecutionQueue;

  if (!targetQueue) {
    throw new Error("Target queue not configured.");
  }
  
  // Prevent immediate running campaigns if one is already active in their respective queue
  if (!delayMs) {
    try {
      const stateStr = await redisConnection!.get(redisKey);
      if (stateStr) {
        const state = JSON.parse(stateStr);
        if (state.status === "running") {
          throw new Error("A campaign of this type is already currently running for this company.");
        }
      }

      // Priority Engine: If a LIVE campaign starts, pause any running REACTIVATION
      if (!data.isReactivation) {
        const reactStateStr = await redisConnection!.get(`campaign-state:reactivation:${data.companyId}`);
        if (reactStateStr) {
          const reactState = JSON.parse(reactStateStr);
          if (reactState.status === "running" || reactState.status === "scheduled") {
            console.log(`[Traffic Cop] Live Campaign started. Pausing Reactivation for company ${data.companyId}.`);
            const pausedState = { ...reactState, status: "paused", pausedBy: "campaign" };
            await redisConnection!.set(`campaign-state:reactivation:${data.companyId}`, JSON.stringify(pausedState));
            // Broadcast pause to UI
            const gateway = CampaignGateway.getInstance();
            if (gateway) gateway.broadcastCampaignUpdate(data.companyId, pausedState);
          }
        }
      }
    } catch (e: any) {
      if (e.message.includes("already currently running")) throw e;
      console.error("Error checking existing campaign state:", e);
    }
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
    activeJobId: !delayMs ? uniqueJobId : undefined,
    totalContacts: data.leads.length,
    completedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    leads: data.leads,
    isReactivation: !!data.isReactivation,
    qStage: data.qStage,
    scheduledAt: delayMs ? data.scheduledAt : undefined,
    uploadedFileName: data.uploadedFileName,
    // Carried through all reactivation waves so the runner can filter on completion
    allOriginalLeads: data.allOriginalLeads ?? data.leads,
    reactivationDateKey: data.reactivationDateKey,
  };
  await redisConnection!.set(redisKey, JSON.stringify(initialState));

  // Broadcast WebSocket event so UI instantly updates to Scheduled/Running
  const gateway = CampaignGateway.getInstance();
  if (gateway) {
    gateway.broadcastCampaignUpdate(data.companyId, initialState);
  }

  // Enqueue the job (with optional delay for scheduled waves)
  await targetQueue.add(uniqueJobId, data, {
    jobId: uniqueJobId,
    delay: delayMs ? Math.max(0, delayMs) : undefined,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export async function getCampaignState(companyId: string, type: "live" | "reactivation" = "live") {
  if (!redisConnection) return null;
  const redisKey = type === "reactivation" ? `campaign-state:reactivation:${companyId}` : `campaign-state:live:${companyId}`;
  const state = await redisConnection.get(redisKey);
  if (state) return JSON.parse(state);

  // Fallback: if Redis has no state, check BullMQ for any pending delayed reactivation jobs
  // This handles the case where Redis state was cleared but the BullMQ job is still scheduled
  const targetQueue = type === "reactivation" ? reactivationExecutionQueue : campaignExecutionQueue;
  if (targetQueue) {
    try {
      const delayedJobs = await targetQueue.getDelayed();
      const pending = delayedJobs.find(
        (job) => job.data.companyId === companyId
      );
      if (pending) {
        const scheduledState = {
          campaignId: pending.data.campaignId,
          status: "scheduled",
          totalContacts: pending.data.leads?.length || 0,
          completedCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          leads: pending.data.leads || [],
          isReactivation: true,
          qStage: pending.data.qStage,
          scheduledAt: pending.data.scheduledAt,
          uploadedFileName: pending.data.uploadedFileName,
        };
        // Re-write to Redis so future requests are fast
        await redisConnection.set(`campaign-state:${companyId}`, JSON.stringify(scheduledState));
        return scheduledState;
      }
    } catch (e) {
      console.error("[getCampaignState] BullMQ fallback check failed:", e);
    }
  }

  return null;
}

export async function clearCampaignState(companyId: string, type: "live" | "reactivation" = "live") {
  if (!redisConnection) return;
  const redisKey = type === "reactivation" ? `campaign-state:reactivation:${companyId}` : `campaign-state:live:${companyId}`;
  await redisConnection.del(redisKey);
  
  const gateway = CampaignGateway.getInstance();
  if (gateway) {
    gateway.broadcastCampaignUpdate(companyId, { status: "idle", leads: [] });
  }
}

export async function forceStopCampaignState(companyId: string, type: "live" | "reactivation" = "live") {
  if (!redisConnection) return;
  const redisKey = type === "reactivation" ? `campaign-state:reactivation:${companyId}` : `campaign-state:live:${companyId}`;
  const stateStr = await redisConnection.get(redisKey);
  if (stateStr) {
    const state = JSON.parse(stateStr);
    
    // Find all ringing/pending calls in DB for this company and mark them as FAILED
    const updatedCount = await prisma.callLog.updateMany({
      where: {
        companyId,
        status: { in: ["PENDING", "QUEUED", "DISPATCHING", "RINGING"] }
      },
      data: {
        status: "FAILED",
        providerStatus: "force_stopped"
      }
    });

    // Update state to reflect newly failed calls
    const newState = { 
      ...state, 
      status: "force_stopped",
      failedCalls: (state.failedCalls || 0) + updatedCount.count,
      completedCalls: (state.completedCalls || 0) + updatedCount.count,
    };
    
    await redisConnection.set(redisKey, JSON.stringify(newState));
    
    // Broadcast WebSocket event so UI instantly updates
    const gateway = CampaignGateway.getInstance();
    if (gateway) {
      gateway.broadcastCampaignUpdate(companyId, newState);
    }
    
    return newState;
  }
  return null;
}

export async function pauseCampaignState(companyId: string, type: "live" | "reactivation" = "live") {
  if (!redisConnection) return null;
  const redisKey = type === "reactivation" ? `campaign-state:reactivation:${companyId}` : `campaign-state:live:${companyId}`;
  const stateStr = await redisConnection.get(redisKey);
  if (stateStr) {
    const state = JSON.parse(stateStr);
    if (state.status === "running") {
      const newState = { ...state, status: "paused" };
      await redisConnection.set(redisKey, JSON.stringify(newState));
      const gateway = CampaignGateway.getInstance();
      if (gateway) gateway.broadcastCampaignUpdate(companyId, newState);
      return newState;
    }
  }
  return null;
}

export async function resumeCampaignState(companyId: string, type: "live" | "reactivation" = "live") {
  if (!redisConnection) return null;
  const redisKey = type === "reactivation" ? `campaign-state:reactivation:${companyId}` : `campaign-state:live:${companyId}`;
  const stateStr = await redisConnection.get(redisKey);
  if (stateStr) {
    const state = JSON.parse(stateStr);
    if (state.status === "paused") {
      const newState = { ...state, status: "running" };
      await redisConnection.set(redisKey, JSON.stringify(newState));
      const gateway = CampaignGateway.getInstance();
      if (gateway) gateway.broadcastCampaignUpdate(companyId, newState);
      return newState;
    }
  }
  return null;
}
