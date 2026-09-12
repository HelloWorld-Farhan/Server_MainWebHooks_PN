export const DEFAULT_OBD_SERVICE_NUMBERS = [
  "7971502709",
  "7971501524",
  "7971502635",
] as const;

export type ObdConfig = {
  /** Full Bonvoice autoCallBridging endpoint URL. */
  baseUrl: string;
  username: string;
  password: string;
  webhookUrl: string | null;
  timeoutMs: number;
  maxRetries: number;
  webhookSecret: string | null;
  serviceNo: string;
  voicebotUrl: string | null;
};

export function assertObdDispatchConfig(
  config: ObdConfig,
): asserts config is ObdConfig & {
  username: string;
  password: string;
} {
  if (!config.baseUrl) {
    throw new Error("OBD configuration error: Missing OBD_BASE_URL");
  }
  if (!config.username || !config.password) {
    throw new Error("OBD configuration error: Missing OBD_USERNAME or OBD_PASSWORD");
  }
  if (!config.serviceNo) {
    throw new Error(
      "OBD configuration error: No default service number or fallback available",
    );
  }
}

export function getObdServiceNumbers(): string[] {
  return [resolveDefaultServiceNo()];
}

export function getDefaultObdServiceNo(): string {
  return resolveDefaultServiceNo();
}

function resolveDefaultServiceNo(): string {
  return (process.env.OBD_SERVICE_NO ?? "917946350797").trim();
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
    baseUrl: (process.env.OBD_BASE_URL ?? "https://backend.pbx.bonvoice.com/autoDialManagement/autoCallBridging/").trim().replace(/\/$/, "") + "/",
    username: (process.env.OBD_USERNAME ?? "PROP_NEXT").trim(),
    password: (process.env.OBD_PASSWORD ?? "PRopne##xt89").trim(),
    webhookUrl: (process.env.OBD_WEBHOOK_URL ?? "").trim() || null,
    timeoutMs: parsePositiveInt(process.env.OBD_TIMEOUT_MS, 30_000),
    maxRetries: parsePositiveInt(process.env.OBD_MAX_RETRIES, 2),
    webhookSecret: (process.env.OBD_WEBHOOK_SECRET ?? "").trim() || null,
    serviceNo: resolveDefaultServiceNo(),
    voicebotUrl: (process.env.OBD_VOICEBOT_URL ?? "").trim() || null,
  };
}

/**
 * Webhook auth uses `OBD_WEBHOOK_SECRET` (header `x-obd-api-key`).
 * Outbound CreateOBDCampaignPost still sends `ukey` from `OBD_API_KEY`.
 */
export function resolveWebhookApiKey(config: ObdConfig): string | null {
  return config.webhookSecret || null;
}
