export const DEFAULT_OBD_SERVICE_NUMBERS = [
  "7971502709",
  "7971501524",
  "7971502635",
] as const;

export type ObdConfig = {
  /** Full VoiceNSMS CreateOBDCampaignPost endpoint URL. */
  baseUrl: string;
  apiKey: string;
  webhookUrl: string | null;
  timeoutMs: number;
  maxRetries: number;
  webhookSecret: string | null;
  serviceNo: string;
  voiceFile: string;
  ivrTemplateId: string;
  retryAttempts: string;
  retryDuration: string;
  sourceType: string;
  campaignType: string;
  fileType: string;
  /** `1` = send immediately; do not include `schddate`. */
  sendNow: string;
};

export function getObdServiceNumbers(): string[] {
  return [...DEFAULT_OBD_SERVICE_NUMBERS];
}

export function getDefaultObdServiceNo(): string {
  return getObdServiceNumbers()[0] ?? "";
}

function resolveDefaultServiceNo(): string {
  return getDefaultObdServiceNo();
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getObdConfig(): ObdConfig {
  return {
    baseUrl: (process.env.OBD_BASE_URL ?? "").trim().replace(/\/$/, ""),
    apiKey: (process.env.OBD_API_KEY ?? "").trim(),
    webhookUrl: (process.env.OBD_WEBHOOK_URL ?? "").trim() || null,
    timeoutMs: parsePositiveInt(process.env.OBD_TIMEOUT_MS, 30_000),
    maxRetries: parsePositiveInt(process.env.OBD_MAX_RETRIES, 2),
    webhookSecret: (process.env.OBD_WEBHOOK_SECRET ?? "").trim() || null,
    serviceNo: resolveDefaultServiceNo(),
    voiceFile: (process.env.OBD_VOICE_FILE ?? "").trim(),
    ivrTemplateId: (process.env.OBD_IVR_TEMPLATE_ID ?? "179").trim(),
    retryAttempts: (process.env.OBD_RETRY_ATTEMPTS ?? "0").trim(),
    retryDuration: (process.env.OBD_RETRY_DURATION ?? "15").trim(),
    sourceType: (process.env.OBD_SOURCE_TYPE ?? "1").trim(),
    campaignType: (process.env.OBD_CAMPAIGN_TYPE ?? "4").trim(),
    fileType: (process.env.OBD_FILE_TYPE ?? "2").trim(),
    sendNow: (process.env.OBD_SEND_NOW ?? "1").trim(),
  };
}

export function assertObdDispatchConfig(config: ObdConfig): void {
  if (!config.baseUrl) {
    throw new Error("OBD_BASE_URL is not configured");
  }
  if (!config.apiKey) {
    throw new Error("OBD_API_KEY is not configured");
  }
  if (!config.serviceNo) {
    throw new Error("No OBD service number is configured");
  }
}

export function resolveWebhookApiKey(config: ObdConfig): string | null {
  return config.webhookSecret ?? (config.apiKey || null);
}
