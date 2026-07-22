import { z } from "zod";

import type { ProviderErrorDetails } from "./provider-error.dto";

export type ObdProviderOutboundSuccess = {
  ok: true;
  providerCallId: string | null;
  raw: unknown;
};

export type ObdProviderOutboundFailure = {
  ok: false;
  error: ProviderErrorDetails;
};

export type ObdProviderOutboundResult =
  | ObdProviderOutboundSuccess
  | ObdProviderOutboundFailure;

/** Parsed success body from OBD provider (VoiceNSMS + generic fallbacks). */
export const obdProviderSuccessBodySchema = z
  .object({
    request_id: z.string().optional(),
    call_id: z.string().optional(),
    id: z.string().optional(),
    campaignid: z.union([z.string(), z.number()]).optional(),
    campaign_id: z.union([z.string(), z.number()]).optional(),
    status: z.union([z.string(), z.number()]).optional(),
    message: z.string().optional(),
    error: z.union([z.string(), z.boolean()]).optional(),
    success: z.boolean().optional(),
  })
  .passthrough();

function stringifyProviderId(
  value: string | number | undefined,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value);
}

export function extractProviderCallId(body: unknown): string | null {
  const parsed = obdProviderSuccessBodySchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  return (
    stringifyProviderId(parsed.data.campaignid) ??
    stringifyProviderId(parsed.data.campaign_id) ??
    parsed.data.request_id ??
    parsed.data.call_id ??
    stringifyProviderId(parsed.data.id) ??
    null
  );
}

export function extractProviderErrorMessage(body: unknown): string | null {
  const parsed = obdProviderSuccessBodySchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.success === false) {
    return parsed.data.message ?? "OBD provider rejected the request";
  }

  if (parsed.data.error === true) {
    return parsed.data.message ?? "OBD provider returned an error";
  }

  const status = parsed.data.status;
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    if (
      normalized === "error" ||
      normalized === "failed" ||
      normalized === "failure"
    ) {
      return parsed.data.message ?? `OBD provider status: ${status}`;
    }
  }

  if (typeof parsed.data.message === "string") {
    const normalized = parsed.data.message.trim().toLowerCase();
    if (
      normalized.includes("invalid") ||
      normalized.includes("error") ||
      normalized.includes("fail")
    ) {
      return parsed.data.message;
    }
  }

  return null;
}
