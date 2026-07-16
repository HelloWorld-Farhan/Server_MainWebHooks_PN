import { gqlDebug } from "@/server/graphql/debug";

type CounterKey =
  | "clerk_api_requests"
  | "clerk_api_429"
  | "clerk_api_retries"
  | "redis_membership_hit"
  | "redis_membership_miss"
  | "redis_company_hit"
  | "redis_company_miss"
  | "cache_invalidations"
  | "circuit_breaker_opens";

const counters: Record<CounterKey, number> = {
  clerk_api_requests: 0,
  clerk_api_429: 0,
  clerk_api_retries: 0,
  redis_membership_hit: 0,
  redis_membership_miss: 0,
  redis_company_hit: 0,
  redis_company_miss: 0,
  cache_invalidations: 0,
  circuit_breaker_opens: 0,
};

let lastReconciliationDurationMs = 0;
let lastCompanyResolutionDurationMs = 0;

export function incrementMetric(key: CounterKey, amount = 1): void {
  counters[key] += amount;
}

export function recordReconciliationDuration(ms: number): void {
  lastReconciliationDurationMs = ms;
}

export function recordCompanyResolutionDuration(ms: number): void {
  lastCompanyResolutionDurationMs = ms;
}

export function getResolutionMetricsSnapshot() {
  return {
    ...counters,
    reconciliation_duration_ms: lastReconciliationDurationMs,
    company_resolution_duration_ms: lastCompanyResolutionDurationMs,
  };
}

export function logResolutionEvent(
  label: string,
  data?: Record<string, unknown>,
): void {
  gqlDebug(label, {
    ...data,
    metrics: getResolutionMetricsSnapshot(),
  });
}
