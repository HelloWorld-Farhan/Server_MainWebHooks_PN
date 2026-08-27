import Redis from "ioredis";

// Initialize a shared Redis connection for BullMQ
// Requires REDIS_URL or UPSTASH_REDIS_URL to be set in .env
const redisUrl = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;

export const redisConnection = redisUrl 
  ? new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    })
  : null;

if (!redisUrl) {
  console.warn("⚠️ REDIS_URL not found. BullMQ features (scheduled callbacks) will be disabled.");
}
