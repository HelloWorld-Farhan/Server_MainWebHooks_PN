import { Queue } from "bullmq";
import { redisConnection } from "./redis.client";
import { CreateRetryOutboundCallInput, CreateOutboundCallInput } from "../services/outbound-calls.service";
import type { TenantContext } from "../types/context";

export const DELAYED_CALLS_QUEUE_NAME = "delayed-calls-queue";

export type DelayedCallJobData = {
  type: "RETRY" | "NEW";
  ctx: TenantContext;
  retryInput?: CreateRetryOutboundCallInput;
  newInput?: CreateOutboundCallInput;
  didNumber: string; // Used for concurrency grouping
};

export const delayedCallsQueue = redisConnection 
  ? new Queue<DelayedCallJobData>(DELAYED_CALLS_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
      },
    })
  : null;

/**
 * Schedule a call to be dispatched at a specific future date/time.
 * @param data Job data
 * @param delayMs Delay in milliseconds
 */
export async function scheduleDelayedCall(data: DelayedCallJobData, delayMs: number) {
  if (!delayedCallsQueue) {
    console.warn("⚠️ Redis not configured. Cannot schedule delayed call.");
    return;
  }
  
  await delayedCallsQueue.add(`call-${data.didNumber}-${Date.now()}`, data, {
    delay: Math.max(0, delayMs),
    jobId: `call-${data.didNumber}-${Date.now()}` // Unique job ID
  });
}
