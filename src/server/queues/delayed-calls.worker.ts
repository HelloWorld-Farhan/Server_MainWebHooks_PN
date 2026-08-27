import { Worker, Job } from "bullmq";
import { redisConnection } from "./redis.client";
import { DELAYED_CALLS_QUEUE_NAME, DelayedCallJobData } from "./delayed-calls.queue";
import { outboundCallsService } from "../services/outbound-calls.service";

// Basic worker that processes the delayed call queue
export const delayedCallsWorker = redisConnection 
  ? new Worker<DelayedCallJobData>(
      DELAYED_CALLS_QUEUE_NAME,
      async (job: Job<DelayedCallJobData>) => {
        const { type, ctx, newInput, retryInput, didNumber } = job.data;
        
        // Note: For strict DID channel concurrency limits (e.g. 4 calls per 079 number),
        // we can implement a Redis semaphore here that checks active calls in DB/Redis
        // before proceeding. If full, we throw an error to trigger a BullMQ retry backoff.
        
        try {
          if (type === "RETRY" && retryInput) {
            await outboundCallsService.createRetryOutboundCall(ctx, retryInput);
          } else if (type === "NEW" && newInput) {
            await outboundCallsService.createOutboundCall(ctx, newInput);
          }
          console.log(`✅ Dispatched ${type} call via BullMQ for DID ${didNumber}`);
        } catch (error: any) {
          console.error(`❌ Failed to dispatch ${type} call via BullMQ for DID ${didNumber}:`, error.message);
          throw error; // Let BullMQ handle retries
        }
      },
      {
        connection: redisConnection,
        concurrency: 10, // Global concurrency for the worker
      }
    )
  : null;

if (delayedCallsWorker) {
  delayedCallsWorker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed with error ${err.message}`);
  });
}
