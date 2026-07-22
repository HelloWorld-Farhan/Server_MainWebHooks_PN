export type RetryLogEvent =
  | "retry:scheduled"
  | "retry:started"
  | "retry:completed"
  | "retry:failed"
  | "retry:skipped";

export function logRetryEvent(
  event: RetryLogEvent,
  fields: {
    campaignPublicId?: string;
    phoneNumber?: string;
    retryNumber?: number;
    correlationId?: string;
    reason?: string;
    parentCallLogId?: string;
    createdCallLogId?: string;
    skipReason?: string;
    error?: string;
  },
): void {
  console.info(`[${event}]`, {
  ...fields,
  at: new Date().toISOString(),
  });
}
