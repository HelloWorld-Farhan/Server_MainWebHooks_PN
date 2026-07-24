import { channelService } from "@/server/channels/channel.service";
import { callService } from "@/server/services/call.service";

/** Drain a single company's Redis queue while free capacity remains. */
export async function drainCompanyQueue(companyId: string): Promise<void> {
  const metrics = await channelService.getMetrics(companyId);
  if (metrics.allocated <= 0) {
    return;
  }

  while (true) {
    const reserved = await channelService.tryReserve(companyId);
    if (!reserved) {
      break;
    }

    const callLogId = await channelService.dequeue(companyId);
    if (!callLogId) {
      await channelService.release(companyId);
      break;
    }

    const dispatched = await callService.dispatchQueuedCall(callLogId);
    if (!dispatched) {
      await channelService.release(companyId);
      // Skip bad/stale entries; keep draining remaining queue.
      continue;
    }
  }
}
