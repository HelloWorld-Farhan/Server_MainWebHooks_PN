import type Redis from "ioredis";

import {
  channelKeys,
  DISPATCH_LOCK_TTL_SECONDS,
  getChannelCooldownMs,
} from "@/server/channels/channel-keys";
import {
  incrementChannelMetric,
  logChannelEvent,
} from "@/server/channels/channel-metrics";
import { isRedisAvailable, redis } from "@/server/cache/redis.client";

const RESERVE_SCRIPT = `
local allocated = tonumber(redis.call('HGET', KEYS[1], 'allocated') or '0')
local active = tonumber(redis.call('HGET', KEYS[1], 'active') or '0')
if active < allocated then
  redis.call('HINCRBY', KEYS[1], 'active', 1)
  return 1
end
return 0
`;

const RELEASE_SCRIPT = `
local active = tonumber(redis.call('HGET', KEYS[1], 'active') or '0')
if active > 0 then
  redis.call('HINCRBY', KEYS[1], 'active', -1)
end
return tonumber(redis.call('HGET', KEYS[1], 'active') or '0')
`;

const ENQUEUE_SCRIPT = `
if redis.call('SADD', KEYS[1], ARGV[1]) == 1 then
  redis.call('RPUSH', KEYS[2], ARGV[1])
  return redis.call('LLEN', KEYS[2])
end
return -1
`;

const ENQUEUE_FRONT_SCRIPT = `
if redis.call('SADD', KEYS[1], ARGV[1]) == 1 then
  redis.call('LPUSH', KEYS[2], ARGV[1])
  return redis.call('LLEN', KEYS[2])
end
return -1
`;

const DEQUEUE_SCRIPT = `
local callLogId = redis.call('LPOP', KEYS[1])
if callLogId then
  redis.call('SREM', KEYS[2], callLogId)
end
return callLogId
`;

const DRAIN_COOLDOWN_SCRIPT = `
local members = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1])
for i, member in ipairs(members) do
  redis.call('ZREM', KEYS[1], member)
end
return members
`;

type InMemoryCompanyState = {
  allocated: number;
  active: number;
  queue: string[];
  dedup: Set<string>;
  cooldown: Map<string, number>;
};

export type ChannelMetrics = {
  allocated: number;
  active: number;
  available: number;
  queueLength: number;
  cooldownCount: number;
};

export type CooldownRelease = {
  companyId: string;
  callLogId: string;
};

export class ChannelService {
  private readonly inMemory = new Map<string, InMemoryCompanyState>();

  private getRedis(): Redis | null {
    return isRedisAvailable() ? redis : null;
  }

  private ensureInMemory(companyId: string): InMemoryCompanyState {
    let state = this.inMemory.get(companyId);
    if (!state) {
      state = {
        allocated: 0,
        active: 0,
        queue: [],
        dedup: new Set(),
        cooldown: new Map(),
      };
      this.inMemory.set(companyId, state);
    }
    return state;
  }

  async initializeCompany(
    companyId: string,
    allocated: number,
    active: number,
    queuedCallLogIds: string[] = [],
  ): Promise<void> {
    const client = this.getRedis();
    if (client) {
      const pipeline = client.pipeline();
      pipeline.del(
        channelKeys.queue(companyId),
        channelKeys.queueDedup(companyId),
        channelKeys.cooldown(companyId),
      );
      pipeline.hset(channelKeys.channels(companyId), {
        allocated: String(allocated),
        active: String(active),
      });
      for (const callLogId of queuedCallLogIds) {
        pipeline.sadd(channelKeys.queueDedup(companyId), callLogId);
        pipeline.rpush(channelKeys.queue(companyId), callLogId);
      }
      await pipeline.exec();
      return;
    }

    const state = this.ensureInMemory(companyId);
    state.allocated = allocated;
    state.active = active;
    state.queue = [...queuedCallLogIds];
    state.dedup = new Set(queuedCallLogIds);
    state.cooldown.clear();
  }

  async tryReserve(companyId: string): Promise<boolean> {
    const client = this.getRedis();
    if (client) {
      const result = await client.eval(
        RESERVE_SCRIPT,
        1,
        channelKeys.channels(companyId),
      );
      const reserved = Number(result) === 1;
      if (reserved) {
        incrementChannelMetric("channels_reserved_total");
        const metrics = await this.getMetrics(companyId);
        logChannelEvent("channels:reserved", {
          companyId,
          active: metrics.active,
          allocated: metrics.allocated,
        });
      }
      return reserved;
    }

    const state = this.ensureInMemory(companyId);
    if (state.active < state.allocated) {
      state.active += 1;
      incrementChannelMetric("channels_reserved_total");
      logChannelEvent("channels:reserved", {
        companyId,
        active: state.active,
        allocated: state.allocated,
      });
      return true;
    }
    return false;
  }

  async release(companyId: string): Promise<number> {
    const client = this.getRedis();
    if (client) {
      const active = Number(
        await client.eval(RELEASE_SCRIPT, 1, channelKeys.channels(companyId)),
      );
      incrementChannelMetric("channels_released_total");
      logChannelEvent("channels:released", { companyId, active });
      return active;
    }

    const state = this.ensureInMemory(companyId);
    if (state.active > 0) {
      state.active -= 1;
    }
    incrementChannelMetric("channels_released_total");
    logChannelEvent("channels:released", {
      companyId,
      active: state.active,
    });
    return state.active;
  }

  async enqueue(companyId: string, callLogId: string): Promise<number> {
    const client = this.getRedis();
    if (client) {
      const result = Number(
        await client.eval(
          ENQUEUE_SCRIPT,
          2,
          channelKeys.queueDedup(companyId),
          channelKeys.queue(companyId),
          callLogId,
        ),
      );
      if (result >= 0) {
        incrementChannelMetric("calls_queued_total");
        logChannelEvent("channels:queued", {
          companyId,
          callLogId,
          queueLength: result,
        });
      }
      return result;
    }

    const state = this.ensureInMemory(companyId);
    if (state.dedup.has(callLogId)) {
      return -1;
    }
    state.dedup.add(callLogId);
    state.queue.push(callLogId);
    incrementChannelMetric("calls_queued_total");
    logChannelEvent("channels:queued", {
      companyId,
      callLogId,
      queueLength: state.queue.length,
    });
    return state.queue.length;
  }

  async enqueueFront(companyId: string, callLogId: string): Promise<number> {
    const client = this.getRedis();
    if (client) {
      const result = Number(
        await client.eval(
          ENQUEUE_FRONT_SCRIPT,
          2,
          channelKeys.queueDedup(companyId),
          channelKeys.queue(companyId),
          callLogId,
        ),
      );
      return result;
    }

    const state = this.ensureInMemory(companyId);
    if (state.dedup.has(callLogId)) {
      return -1;
    }
    state.dedup.add(callLogId);
    state.queue.unshift(callLogId);
    return state.queue.length;
  }

  async dequeue(companyId: string): Promise<string | null> {
    const client = this.getRedis();
    if (client) {
      const result = await client.eval(
        DEQUEUE_SCRIPT,
        2,
        channelKeys.queue(companyId),
        channelKeys.queueDedup(companyId),
      );
      return result ? String(result) : null;
    }

    const state = this.ensureInMemory(companyId);
    const callLogId = state.queue.shift() ?? null;
    if (callLogId) {
      state.dedup.delete(callLogId);
    }
    return callLogId;
  }

  async startCooldown(
    companyId: string,
    callLogId: string,
    ms: number = getChannelCooldownMs(),
  ): Promise<void> {
    const releaseAt = Date.now() + ms;
    const client = this.getRedis();
    if (client) {
      await client.zadd(
        channelKeys.cooldown(companyId),
        releaseAt,
        callLogId,
      );
    } else {
      this.ensureInMemory(companyId).cooldown.set(callLogId, releaseAt);
    }

    logChannelEvent("channels:cooldown:started", {
      companyId,
      callLogId,
      releaseAt,
    });
  }

  async drainExpiredCooldowns(): Promise<CooldownRelease[]> {
    const now = Date.now();
    const releases: CooldownRelease[] = [];
    const client = this.getRedis();

    if (client) {
      const keys = await client.keys("company:*:cooldown");
      for (const key of keys) {
        const companyId = key.split(":")[1];
        if (!companyId) {
          continue;
        }

        const members = (await client.eval(
          DRAIN_COOLDOWN_SCRIPT,
          1,
          key,
          String(now),
        )) as string[];

        for (const callLogId of members) {
          releases.push({ companyId, callLogId });
          logChannelEvent("channels:cooldown:completed", {
            companyId,
            callLogId,
          });
        }
      }
      return releases;
    }

    for (const [companyId, state] of this.inMemory.entries()) {
      for (const [callLogId, releaseAt] of state.cooldown.entries()) {
        if (releaseAt <= now) {
          state.cooldown.delete(callLogId);
          releases.push({ companyId, callLogId });
          logChannelEvent("channels:cooldown:completed", {
            companyId,
            callLogId,
          });
        }
      }
    }

    return releases;
  }

  async acquireDispatchLock(callLogId: string): Promise<boolean> {
    const client = this.getRedis();
    if (client) {
      const result = await client.set(
        channelKeys.dispatchLock(callLogId),
        "1",
        "EX",
        DISPATCH_LOCK_TTL_SECONDS,
        "NX",
      );
      return result === "OK";
    }

    const state = this.ensureInMemory("__locks__");
    if (state.dedup.has(callLogId)) {
      return false;
    }
    state.dedup.add(callLogId);
    return true;
  }

  async releaseDispatchLock(callLogId: string): Promise<void> {
    const client = this.getRedis();
    if (client) {
      await client.del(channelKeys.dispatchLock(callLogId));
      return;
    }

    this.ensureInMemory("__locks__").dedup.delete(callLogId);
  }

  async getMetrics(companyId: string): Promise<ChannelMetrics> {
    const client = this.getRedis();
    if (client) {
      const pipeline = client.pipeline();
      pipeline.hgetall(channelKeys.channels(companyId));
      pipeline.llen(channelKeys.queue(companyId));
      pipeline.zcard(channelKeys.cooldown(companyId));
      const results = await pipeline.exec();

      const hash = (results?.[0]?.[1] ?? {}) as Record<string, string>;
      const allocated = Number(hash.allocated ?? 0);
      const active = Number(hash.active ?? 0);
      const queueLength = Number(results?.[1]?.[1] ?? 0);
      const cooldownCount = Number(results?.[2]?.[1] ?? 0);

      return {
        allocated,
        active,
        available: Math.max(allocated - active, 0),
        queueLength,
        cooldownCount,
      };
    }

    const state = this.ensureInMemory(companyId);
    return {
      allocated: state.allocated,
      active: state.active,
      available: Math.max(state.allocated - state.active, 0),
      queueLength: state.queue.length,
      cooldownCount: state.cooldown.size,
    };
  }

  resetInMemoryForTests(): void {
    this.inMemory.clear();
  }
}

export const channelService = new ChannelService();
