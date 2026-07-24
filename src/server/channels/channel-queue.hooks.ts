type CompanyQueueWakeFn = (companyId: string) => Promise<void>;

let wakeFn: CompanyQueueWakeFn | null = null;

/** Registered by ChannelQueueWorker on startup to avoid import cycles. */
export function registerCompanyQueueWake(fn: CompanyQueueWakeFn): void {
  wakeFn = fn;
}

/** Fire-and-forget drain after a channel slot is freed without a cooldown. */
export function wakeCompanyQueue(companyId: string): void {
  if (!wakeFn) {
    return;
  }
  void wakeFn(companyId).catch((error) => {
    console.warn("[channels] wakeCompanyQueue failed", {
      companyId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
