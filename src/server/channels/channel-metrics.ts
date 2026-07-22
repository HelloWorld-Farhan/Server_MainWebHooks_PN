import { gqlDebug } from "@/server/graphql/debug";

type CounterKey =
  | "channels_reserved_total"
  | "channels_released_total"
  | "calls_queued_total"
  | "calls_dispatched_from_queue_total";

const counters: Record<CounterKey, number> = {
  channels_reserved_total: 0,
  channels_released_total: 0,
  calls_queued_total: 0,
  calls_dispatched_from_queue_total: 0,
};

const queueWaitSamples: number[] = [];
const MAX_QUEUE_WAIT_SAMPLES = 500;

export function incrementChannelMetric(key: CounterKey, amount = 1): void {
  counters[key] += amount;
}

export function recordQueueWaitMs(ms: number): void {
  queueWaitSamples.push(ms);
  if (queueWaitSamples.length > MAX_QUEUE_WAIT_SAMPLES) {
    queueWaitSamples.shift();
  }
}

export function getChannelMetricsSnapshot() {
  const waitCount = queueWaitSamples.length;
  const averageQueueWaitMs =
    waitCount === 0
      ? 0
      : Math.round(
          queueWaitSamples.reduce((sum, value) => sum + value, 0) / waitCount,
        );

  return {
    ...counters,
    average_queue_wait_ms: averageQueueWaitMs,
    queue_wait_sample_count: waitCount,
  };
}

export function logChannelEvent(
  label: string,
  data?: Record<string, unknown>,
): void {
  gqlDebug(label, {
    ...data,
    channelMetrics: getChannelMetricsSnapshot(),
  });
}
