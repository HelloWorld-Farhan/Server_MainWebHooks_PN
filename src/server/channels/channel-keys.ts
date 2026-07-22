export function getChannelCooldownMs(): number {
  return Number(process.env.CHANNEL_COOLDOWN_MS ?? 5_000);
}

export function getChannelQueuePollMs(): number {
  return Number(process.env.CHANNEL_QUEUE_POLL_MS ?? 1_000);
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
