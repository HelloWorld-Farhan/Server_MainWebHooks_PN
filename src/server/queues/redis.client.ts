import Redis from "ioredis";

// Build Redis connection config
// Explicit host/port/password avoids URL-parsing issues with special characters (e.g. @ in password)
function createRedisConnection(): Redis | null {
  const redisUrl = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;

  if (!redisUrl) {
    console.warn("⚠️ REDIS_URL not found. BullMQ features (outbound campaigns) will be disabled.");
    return null;
  }

  try {
    // Parse URL manually to safely extract password even if it contains '@'
    // URL format: redis://:password@host:port  OR  redis://host:port
    let host = "127.0.0.1";
    let port = 6379;
    let password: string | undefined;

    // Strip scheme
    const withoutScheme = redisUrl.replace(/^rediss?:\/\//, "");
    
    // Find the last '@' — everything before it is auth info
    const lastAt = withoutScheme.lastIndexOf("@");
    if (lastAt !== -1) {
      const auth = withoutScheme.substring(0, lastAt);        // e.g. ":Propnexai@123"
      const hostPart = withoutScheme.substring(lastAt + 1);  // e.g. "200.234.34.240:6379"
      
      // auth is "username:password" or ":password"
      const colonIdx = auth.indexOf(":");
      if (colonIdx !== -1) {
        password = auth.substring(colonIdx + 1) || undefined;
      } else {
        password = auth || undefined;
      }
      
      // parse host:port
      const portIdx = hostPart.lastIndexOf(":");
      if (portIdx !== -1) {
        host = hostPart.substring(0, portIdx);
        port = parseInt(hostPart.substring(portIdx + 1), 10) || 6379;
      } else {
        host = hostPart;
      }
    } else {
      // No auth — just host:port
      const portIdx = withoutScheme.lastIndexOf(":");
      if (portIdx !== -1) {
        host = withoutScheme.substring(0, portIdx);
        port = parseInt(withoutScheme.substring(portIdx + 1), 10) || 6379;
      } else {
        host = withoutScheme;
      }
    }

    console.log(`🔗 Redis connecting to ${host}:${port} ${password ? "(with password)" : "(no password)"}`);

    return new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
  } catch (e) {
    console.error("❌ Failed to parse REDIS_URL:", e);
    return null;
  }
}

export const redisConnection = createRedisConnection();
