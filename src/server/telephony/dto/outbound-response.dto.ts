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
    value: z.union([z.string(), z.number()]).optional(),
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

/**
 * Optional provider ID from CreateOBD (audit only when present).
 * VoiceNSMS correlates call status via webhook `callid` (our call log public ID).
 */
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

function normalizeProviderStatus(status: unknown): string | null {
  if (typeof status === "string") {
    return status.trim().toLowerCase();
  }
  if (typeof status === "number") {
    return String(status);
  }
  return null;
}

function normalizeProviderValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
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

  const status = normalizeProviderStatus(parsed.data.status);
  if (status === "error" || status === "failed" || status === "failure") {
    return parsed.data.message ?? `OBD provider status: ${status}`;
  }

  const value = normalizeProviderValue(parsed.data.value);
  // VoiceNSMS happy path is often `{ value: "accepted", status: "success" }` with no ID.
  // Call status is delivered later via webhook correlated on our `callid`.
  if (
    value &&
    value !== "accepted" &&
    (value.includes("invalid") ||
      value.includes("error") ||
      value.includes("fail") ||
      value.includes("reject"))
  ) {
    return parsed.data.message ?? `OBD provider value: ${value}`;
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
