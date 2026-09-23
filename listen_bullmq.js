require("dotenv").config();
const { QueueEvents } = require("bullmq");
const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queueEvents = new QueueEvents("campaign-execution-queue", { connection: redis });

queueEvents.on("completed", ({ jobId, returnvalue }) => {
  console.log(`[COMPLETED] Job ${jobId} completed! Return value:`, returnvalue);
});

queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.log(`[FAILED] Job ${jobId} failed! Reason:`, failedReason);
});

console.log("Listening to BullMQ events...");
