import Redis from "ioredis";

// Initialize a shared Redis connection for BullMQ
// Requires REDIS_URL or UPSTASH_REDIS_URL to be set in .env
const redisUrl = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL || "rediss://default:gQAAAAAAA3SWAAIgcDFmNDM3NWM5OTI2MmM0M2FjYTM4Yjc0ZDM5YzU5NTNlMQ@pet-dove-226454.upstash.io:6379";

export const redisConnection = redisUrl 
  ? new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    })
  : null;

if (!redisUrl) {
  console.warn("⚠️ REDIS_URL not found. BullMQ features (scheduled callbacks) will be disabled.");
}
