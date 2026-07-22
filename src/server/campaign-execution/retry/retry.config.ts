function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export const retryConfig = {
  defaultMaxRetries: parsePositiveInt(process.env.DEFAULT_MAX_RETRIES, 3),
  defaultRetryDelaySeconds: parsePositiveInt(
    process.env.DEFAULT_RETRY_DELAY_SECONDS,
    300,
  ),
  workerIntervalMs: parsePositiveInt(
    process.env.RETRY_WORKER_INTERVAL_MS,
    2000,
  ),
  maxPendingRetries: parsePositiveInt(process.env.MAX_PENDING_RETRIES, 1000),
  processBatchSize: parsePositiveInt(process.env.RETRY_BATCH_SIZE, 50),
};

export const DEFAULT_RETRY_POLICY = {
  retryEnabled: true,
  maxRetries: retryConfig.defaultMaxRetries,
  retryDelaySeconds: retryConfig.defaultRetryDelaySeconds,
  retryOnBusy: true,
  retryOnNoAnswer: true,
  retryOnFailed: true,
  retryOnCancelled: false,
  retryOnVoicemail: false,
  retryOnMissed: true,
} as const;
