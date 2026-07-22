import type { CallStatus } from "@prisma/client";

const PROVIDER_STATUS_MAP: Record<string, CallStatus> = {
  SUCCESS: "COMPLETED",
  ANSWERED: "ANSWERED",
  COMPLETED: "COMPLETED",
  RINGING: "RINGING",
  BUSY: "BUSY",
  NO_ANSWER: "NO_ANSWER",
  UNANSWERED: "NO_ANSWER",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  FAILED: "FAILED",
  ERROR: "FAILED",
  VOICEMAIL: "VOICEMAIL",
  QUEUED: "QUEUED_AT_PROVIDER",
  QUEUED_AT_PROVIDER: "QUEUED_AT_PROVIDER",
  PENDING: "PENDING",
  DISPATCHING: "DISPATCHING",
  // Legacy dialer-style mappings for provider strings
  MISSED: "MISSED",
};

/**
 * Map a raw OBD provider status string to an internal CallStatus.
 * Unknown values default to FAILED.
 */
export function mapProviderStatusToCallStatus(
  providerStatus: string,
): CallStatus {
  const normalized = providerStatus.trim().toUpperCase();
  return PROVIDER_STATUS_MAP[normalized] ?? "FAILED";
}
