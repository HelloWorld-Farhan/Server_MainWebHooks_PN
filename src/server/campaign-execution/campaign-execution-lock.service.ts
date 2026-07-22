import type Redis from "ioredis";

import { redis } from "@/server/cache/redis.client";
import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";

const LOCK_PREFIX = "campaign:runner-lock:";

type InMemoryLock = {
  owner: string;
  expiresAt: number;
};

export class CampaignExecutionLockService {
  private readonly inMemory = new Map<string, InMemoryLock>();

  private getRedis(): Redis | null {
    return redis?.status === "ready" ? redis : null;
  }

  private lockKey(campaignId: string): string {
    return `${LOCK_PREFIX}${campaignId}`;
  }

  async acquire(campaignId: string, workerId: string): Promise<boolean> {
    const ttlMs = campaignExecutionConfig.lockTtlMs;
    const client = this.getRedis();

    if (client) {
      const result = await client.set(
        this.lockKey(campaignId),
        workerId,
        "PX",
        ttlMs,
        "NX",
      );
      return result === "OK";
    }

    const now = Date.now();
    const existing = this.inMemory.get(campaignId);
    if (existing && existing.expiresAt > now && existing.owner !== workerId) {
      return false;
    }

    this.inMemory.set(campaignId, {
      owner: workerId,
      expiresAt: now + ttlMs,
    });
    return true;
  }

  async renew(campaignId: string, workerId: string): Promise<boolean> {
    const ttlMs = campaignExecutionConfig.lockTtlMs;
    const client = this.getRedis();

    if (client) {
      const key = this.lockKey(campaignId);
      const current = await client.get(key);
      if (current !== workerId) {
        return false;
      }
      await client.pexpire(key, ttlMs);
      return true;
    }

    const existing = this.inMemory.get(campaignId);
    if (!existing || existing.owner !== workerId) {
      return false;
    }
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async release(campaignId: string, workerId: string): Promise<void> {
    const client = this.getRedis();

    if (client) {
      const key = this.lockKey(campaignId);
      const current = await client.get(key);
      if (current === workerId) {
        await client.del(key);
      }
      return;
    }

    const existing = this.inMemory.get(campaignId);
    if (existing?.owner === workerId) {
      this.inMemory.delete(campaignId);
    }
  }

  resetInMemoryForTests(): void {
    this.inMemory.clear();
  }
}

export const campaignExecutionLockService = new CampaignExecutionLockService();
