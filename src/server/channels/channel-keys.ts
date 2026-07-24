export function getChannelCooldownMs(): number {
  return Number(process.env.CHANNEL_COOLDOWN_MS ?? 5_000);
}

export function getChannelQueuePollMs(): number {
  return Number(process.env.CHANNEL_QUEUE_POLL_MS ?? 1_000);
}

/** How often to resync Redis channel state from DB and fail stale in-flight calls. */
export function getChannelReconcilePollMs(): number {
  const parsed = Number(process.env.CHANNEL_RECONCILE_POLL_MS ?? 30_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

/**
 * QUEUED_AT_PROVIDER older than this (no terminal webhook) is failed so the
 * channel slot can be released. OBD providers often accept without completing.
 */
export function getStaleQueuedAtProviderMs(): number {
  const parsed = Number(
    process.env.CHANNEL_STALE_QUEUED_AT_PROVIDER_MS ?? 2 * 60 * 1000,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2 * 60 * 1000;
}

/** @deprecated Use getChannelCooldownMs() */
export const CHANNEL_COOLDOWN_MS = getChannelCooldownMs();

/** @deprecated Use getChannelQueuePollMs() */
export const CHANNEL_QUEUE_POLL_MS = getChannelQueuePollMs();

export const DISPATCH_LOCK_TTL_SECONDS = 60;

export const channelKeys = {
  channels: (companyId: string) => `company:${companyId}:channels`,
  queue: (companyId: string) => `company:${companyId}:queue`,
  queueDedup: (companyId: string) => `company:${companyId}:queue:dedup`,
  cooldown: (companyId: string) => `company:${companyId}:cooldown`,
  dispatchLock: (callLogId: string) => `call:dispatch-lock:${callLogId}`,
  companyPrefix: (companyId: string) => `company:${companyId}:*`,
};
