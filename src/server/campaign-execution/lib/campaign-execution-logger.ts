import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";

type LogPayload = Record<string, string | number | boolean | null | undefined>;

export function logCampaignExecutionEvent(
  event: string,
  payload: LogPayload,
): void {
  const entry = {
    event,
    workerId: campaignExecutionConfig.workerId,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.info("[campaign-execution]", JSON.stringify(entry));
}
