import { clerkClient } from "@/auth/clerk";

import { cacheService } from "@/server/cache/cache.service";
import {
  CACHE_TTL,
  CLERK_MEMBERSHIPS_STALE_MS,
  cacheKeys,
} from "@/server/cache/keys";
import { gqlDebug, gqlDebugTimed } from "@/server/graphql/debug";
import {
  getClerkRetryAfter,
  isClerkNotFound,
  isClerkOrganizationsUnavailable,
  isClerkRateLimited,
  sleep,
} from "@/server/lib/clerk-errors";
import {
  incrementMetric,
  logResolutionEvent,
} from "@/server/lib/resolution-metrics";

const MAX_RETRIES = 2;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
const CIRCUIT_WINDOW_MS = 60_000;

export type ClerkMembershipSnapshot = {
  role: string;
  organization: { id: string; name: string };
  publicMetadata?: Record<string, unknown>;
  publicUserData?: { userId: string; identifier?: string } | null;
};

export type ClerkMembershipList = {
  data: ClerkMembershipSnapshot[];
  totalCount: number;
};

type CircuitState = {
  failures: number[];
  openUntil: number;
};

const pendingUserFetches = new Map<string, Promise<ClerkMembershipList>>();
const pendingOrgFetches = new Map<string, Promise<ClerkMembershipList>>();
const userCircuit: CircuitState = { failures: [], openUntil: 0 };
const orgCircuit: CircuitState = { failures: [], openUntil: 0 };

function recordFailure(circuit: CircuitState): void {
  const now = Date.now();
  circuit.failures = circuit.failures.filter((t) => now - t < CIRCUIT_WINDOW_MS);
  circuit.failures.push(now);

  if (circuit.failures.length >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.openUntil = now + CIRCUIT_COOLDOWN_MS;
    incrementMetric("circuit_breaker_opens");
    logResolutionEvent("clerk:circuit-breaker:open", {
      failures: circuit.failures.length,
      cooldownMs: CIRCUIT_COOLDOWN_MS,
    });
  }
}

function isCircuitOpen(circuit: CircuitState): boolean {
  return Date.now() < circuit.openUntil;
}

function resetCircuit(circuit: CircuitState): void {
  circuit.failures = [];
  circuit.openUntil = 0;
}

async function callClerkWithRetry<T>(
  label: string,
  circuit: CircuitState,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      incrementMetric("clerk_api_requests");
      const start = performance.now();
      const result = await gqlDebugTimed(label, fn);
      gqlDebug("clerk:api:latency", {
        label,
        ms: Math.round(performance.now() - start),
      });
      resetCircuit(circuit);
      return result;
    } catch (error) {
      lastError = error;

      if (isClerkOrganizationsUnavailable(error)) {
        throw error;
      }

      if (isClerkRateLimited(error)) {
        incrementMetric("clerk_api_429");
        recordFailure(circuit);

        if (attempt < MAX_RETRIES) {
          incrementMetric("clerk_api_retries");
          const delayMs = getClerkRetryAfter(error);
          gqlDebug("clerk:rate-limited:retry", { label, attempt, delayMs });
          await sleep(delayMs);
          continue;
        }
      } else {
        recordFailure(circuit);
      }

      throw error;
    }
  }

  throw lastError;
}

async function fetchUserMembershipsFromClerk(
  clerkUserId: string,
): Promise<ClerkMembershipList> {
  const client = clerkClient;
  try {
    const result = await callClerkWithRetry<ClerkMembershipList>(
      "clerk:getUserMemberships",
      userCircuit,
      () =>
        client.users.getOrganizationMembershipList({
          userId: clerkUserId,
          limit: 10,
        }) as Promise<ClerkMembershipList>,
    );
    return {
      data: result.data as ClerkMembershipSnapshot[],
      totalCount: result.totalCount,
    };
  } catch (error) {
    if (isClerkOrganizationsUnavailable(error)) {
      return { data: [], totalCount: 0 };
    }
    throw error;
  }
}

async function fetchOrgMembershipsFromClerk(
  orgId: string,
): Promise<ClerkMembershipList> {
  const client = clerkClient;
  try {
    const result = await callClerkWithRetry<ClerkMembershipList>(
      "clerk:getOrgMemberships",
      orgCircuit,
      () =>
        client.organizations.getOrganizationMembershipList({
          organizationId: orgId,
          limit: 100,
        }) as Promise<ClerkMembershipList>,
    );
    return {
      data: result.data as ClerkMembershipSnapshot[],
      totalCount: result.totalCount,
    };
  } catch (error) {
    if (isClerkNotFound(error) || isClerkOrganizationsUnavailable(error)) {
      return { data: [], totalCount: 0 };
    }
    throw error;
  }
}

async function readMembershipCache(
  key: string,
): Promise<ClerkMembershipList | null> {
  const payload = await cacheService.getCachedPayload<ClerkMembershipList>(key);
  return payload?.data ?? null;
}

async function writeMembershipCache(
  key: string,
  data: ClerkMembershipList,
  ttlSeconds: number,
): Promise<void> {
  await cacheService.setCachedPayload(key, data, ttlSeconds);
}

function scheduleBackgroundRefresh(
  key: string,
  refresh: () => Promise<void>,
): void {
  void refresh().catch((error) => {
    gqlDebug("clerk:swr:refresh:error", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export class ClerkMembershipService {
  async getUserMemberships(clerkUserId: string): Promise<ClerkMembershipList> {
    const cacheKey = cacheKeys.clerkMemberships(clerkUserId);

    if (isCircuitOpen(userCircuit)) {
      const stale = await readMembershipCache(cacheKey);
      if (stale) {
        gqlDebug("clerk:circuit-breaker:stale-hit", { clerkUserId });
        return stale;
      }
      return { data: [], totalCount: 0 };
    }

    const cachedPayload = await cacheService.getCachedPayload<ClerkMembershipList>(
      cacheKey,
    );
    if (cachedPayload) {
      const ageMs = Date.now() - cachedPayload.cachedAt;
      incrementMetric("redis_membership_hit");
      gqlDebug("clerk:memberships:cache-hit", { clerkUserId, ageMs });

      if (ageMs >= CLERK_MEMBERSHIPS_STALE_MS) {
        scheduleBackgroundRefresh(cacheKey, async () => {
          await this.refreshUserMemberships(clerkUserId);
        });
      }

      return cachedPayload.data;
    }

    incrementMetric("redis_membership_miss");
    return this.refreshUserMemberships(clerkUserId);
  }

  private async refreshUserMemberships(
    clerkUserId: string,
  ): Promise<ClerkMembershipList> {
    const cacheKey = cacheKeys.clerkMemberships(clerkUserId);
    const pendingKey = `user:${clerkUserId}`;
    const existing = pendingUserFetches.get(pendingKey);
    if (existing) {
      gqlDebug("clerk:memberships:dedup", { clerkUserId });
      return existing;
    }

    const promise = (async () => {
      try {
        if (isCircuitOpen(userCircuit)) {
          const stale = await readMembershipCache(cacheKey);
          if (stale) return stale;
          return { data: [], totalCount: 0 };
        }

        const data = await fetchUserMembershipsFromClerk(clerkUserId);
        await writeMembershipCache(
          cacheKey,
          data,
          CACHE_TTL.CLERK_MEMBERSHIPS,
        );
        return data;
      } catch (error) {
        const stale = await readMembershipCache(cacheKey);
        if (stale) {
          gqlDebug("clerk:memberships:fallback-stale", { clerkUserId });
          return stale;
        }

        if (isClerkRateLimited(error)) {
          gqlDebug("clerk:memberships:rate-limited-empty", { clerkUserId });
          return { data: [], totalCount: 0 };
        }

        if (isClerkOrganizationsUnavailable(error)) {
          gqlDebug("clerk:memberships:orgs-unavailable-empty", { clerkUserId });
          return { data: [], totalCount: 0 };
        }

        throw error;
      }
    })();

    pendingUserFetches.set(pendingKey, promise);
    try {
      return await promise;
    } finally {
      pendingUserFetches.delete(pendingKey);
    }
  }

  async getOrgMemberships(orgId: string): Promise<ClerkMembershipList> {
    if (!orgId.startsWith("org_")) {
      return { data: [], totalCount: 0 };
    }

    const cacheKey = cacheKeys.clerkOrgMemberships(orgId);

    if (isCircuitOpen(orgCircuit)) {
      const stale = await readMembershipCache(cacheKey);
      if (stale) return stale;
      return { data: [], totalCount: 0 };
    }

    const cachedPayload = await cacheService.getCachedPayload<ClerkMembershipList>(
      cacheKey,
    );
    if (cachedPayload) {
      const ageMs = Date.now() - cachedPayload.cachedAt;
      if (ageMs < CLERK_MEMBERSHIPS_STALE_MS) {
        return cachedPayload.data;
      }
      scheduleBackgroundRefresh(cacheKey, async () => {
        await this.refreshOrgMemberships(orgId);
      });
      return cachedPayload.data;
    }

    return this.refreshOrgMemberships(orgId);
  }

  private async refreshOrgMemberships(
    orgId: string,
  ): Promise<ClerkMembershipList> {
    const cacheKey = cacheKeys.clerkOrgMemberships(orgId);
    const pendingKey = `org:${orgId}`;
    const existing = pendingOrgFetches.get(pendingKey);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const data = await fetchOrgMembershipsFromClerk(orgId);
        await writeMembershipCache(
          cacheKey,
          data,
          CACHE_TTL.CLERK_ORG_MEMBERSHIPS,
        );
        return data;
      } catch {
        const stale = await readMembershipCache(cacheKey);
        if (stale) return stale;
        return { data: [], totalCount: 0 };
      }
    })();

    pendingOrgFetches.set(pendingKey, promise);
    try {
      return await promise;
    } finally {
      pendingOrgFetches.delete(pendingKey);
    }
  }

  async getMembershipInOrg(
    clerkUserId: string,
    clerkOrganizationId: string,
  ): Promise<ClerkMembershipSnapshot | null> {
    if (!clerkOrganizationId.startsWith("org_")) {
      return null;
    }

    const fromUser = (await this.getUserMemberships(clerkUserId)).data.find(
      (membership) => membership.organization.id === clerkOrganizationId,
    );
    if (fromUser) {
      return fromUser;
    }

    const orgList = await this.getOrgMemberships(clerkOrganizationId);
    return (
      orgList.data.find(
        (membership) => membership.publicUserData?.userId === clerkUserId,
      ) ?? null
    );
  }

  async isOrganizationMember(
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    const membership = await this.getMembershipInOrg(userId, organizationId);
    return membership !== null;
  }

  async invalidateUser(clerkUserId: string): Promise<void> {
    await cacheService.invalidateClerkMembershipCaches(clerkUserId);
  }

  async invalidateOrg(orgId: string): Promise<void> {
    await cacheService.del(cacheKeys.clerkOrgMemberships(orgId));
    incrementMetric("cache_invalidations");
  }
}

export const clerkMembershipService = new ClerkMembershipService();
