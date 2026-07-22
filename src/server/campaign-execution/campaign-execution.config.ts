import { hostname } from "node:os";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export const campaignExecutionConfig = {
  batchSize: parsePositiveInt(process.env.CAMPAIGN_BATCH_SIZE, 100),
  schedulerIntervalMs: parsePositiveInt(
    process.env.CAMPAIGN_SCHEDULER_INTERVAL_MS,
    5000,
  ),
  runnerIntervalMs: parsePositiveInt(
    process.env.CAMPAIGN_RUNNER_INTERVAL_MS,
    2000,
  ),
  progressIntervalMs: parsePositiveInt(
    process.env.CAMPAIGN_PROGRESS_UPDATE_INTERVAL_MS,
    10000,
  ),
  maxConcurrentCampaigns: parsePositiveInt(
    process.env.CAMPAIGN_MAX_CONCURRENT_CAMPAIGNS,
    5,
  ),
  lockTtlMs: parsePositiveInt(process.env.CAMPAIGN_LOCK_TTL_MS, 30000),
  workerId:
    process.env.CAMPAIGN_WORKER_ID?.trim() ||
    `${hostname()}:${process.pid}`,
};
