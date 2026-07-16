import { redis } from "@/server/cache/redis.client";
import {
  CACHE_TTL,
  PAGE_CACHE_STALE_MS,
} from "@/server/cache/keys";
import { gqlDebug, gqlDebugTimed } from "@/server/graphql/debug";

export interface CachedPagePayload<T> {
  cachedAt: number;
  data: T;
}

export interface PageCacheResult<T> {
  data: T;
  cachedAt: number;
  fromCache: boolean;
}

export class PageCacheService {
  async getPageData<T>(
    cacheKey: string,
    loader: () => Promise<T>,
    options?: { staleAfterMs?: number; ttlSeconds?: number },
  ): Promise<PageCacheResult<T>> {
    const staleAfterMs = options?.staleAfterMs ?? PAGE_CACHE_STALE_MS;
    const ttlSeconds = options?.ttlSeconds ?? CACHE_TTL.PAGE_CACHE;

    if (redis) {
      try {
        const cached = await gqlDebugTimed(`redis:page:get:${cacheKey}`, () =>
          redis!.get(cacheKey),
        );

        if (cached) {
          const payload = JSON.parse(cached) as CachedPagePayload<T>;
          const ageMs = Date.now() - payload.cachedAt;
          if (ageMs < staleAfterMs) {
            gqlDebug("redis:page:hit", { cacheKey, ageMs });
            return {
              data: payload.data,
              cachedAt: payload.cachedAt,
              fromCache: true,
            };
          }
          gqlDebug("redis:page:stale", { cacheKey, ageMs });
        }
      } catch {
        gqlDebug("redis:page:get:error", { cacheKey });
      }
    }

    const data = await gqlDebugTimed(`page:loader:${cacheKey}`, loader);
    const cachedAt = Date.now();
    const payload: CachedPagePayload<T> = { cachedAt, data };

    if (redis) {
      try {
        await gqlDebugTimed(`redis:page:set:${cacheKey}`, () =>
          redis!.setex(cacheKey, ttlSeconds, JSON.stringify(payload)),
        );
      } catch {
        gqlDebug("redis:page:set:error", { cacheKey });
      }
    }

    return { data, cachedAt, fromCache: false };
  }

  async invalidateKey(cacheKey: string): Promise<void> {
    if (!redis) return;
    try {
      await redis.del(cacheKey);
    } catch {
      gqlDebug("redis:page:invalidate:error", { cacheKey });
    }
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    if (!redis) return;
    try {
      const pattern = `${prefix}*`;
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== "0");
    } catch {
      gqlDebug("redis:page:invalidate-prefix:error", { prefix });
    }
  }
}

export const pageCacheService = new PageCacheService();
