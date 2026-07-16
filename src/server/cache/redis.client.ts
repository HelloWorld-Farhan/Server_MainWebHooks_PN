import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function resolveRedisUrl(): string | null {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;
  const user = process.env.REDIS_USER ?? "default";

  if (host && port && password) {
    return `redis://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`;
  }

  return null;
}

function createRedisClient(): Redis | null {
  const url = resolveRedisUrl();
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[redis] REDIS_URL is not set; caching disabled");
    }
    return null;
  }

  return new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 3000,
    enableOfflineQueue: false,
  });
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production" && redis) {
  globalForRedis.redis = redis;
}

export function isRedisAvailable(): boolean {
  return redis !== null && redis.status === "ready";
}
