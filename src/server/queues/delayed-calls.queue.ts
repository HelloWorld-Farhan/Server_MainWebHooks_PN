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
  
  const uniqueId = Math.random().toString(36).substring(2, 9);
  const jobId = `call-${data.didNumber}-${Date.now()}-${uniqueId}`;
  await delayedCallsQueue.add(jobId, data, {
    delay: Math.max(0, delayMs),
    jobId
  });
}
