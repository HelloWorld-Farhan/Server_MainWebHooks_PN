import type { CallStatus } from "@prisma/client";

const TERMINAL_STATUSES = new Set<CallStatus>([
  "COMPLETED",
  "FAILED",
  "BUSY",
  "NO_ANSWER",
  "CANCELLED",
  "MISSED",
  "VOICEMAIL",
]);

const STATUS_RANK: Record<CallStatus, number> = {
  PENDING: 0,
  QUEUED: 1,
  DISPATCHING: 2,
  QUEUED_AT_PROVIDER: 3,
  RINGING: 4,
  ANSWERED: 5,
  COMPLETED: 100,
  FAILED: 100,
  BUSY: 100,
  NO_ANSWER: 100,
  CANCELLED: 100,
  MISSED: 100,
  VOICEMAIL: 100,
};

export function isTerminalCallStatus(status: CallStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransitionCallStatus(
  from: CallStatus,
  to: CallStatus,
): boolean {
  if (from === to) {
    return true;
  }
  if (isTerminalCallStatus(from)) {
    return false;
  }
  return STATUS_RANK[to] >= STATUS_RANK[from];
}

export function isProviderCompletedStatus(status: CallStatus): boolean {
  return (
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "BUSY" ||
    status === "NO_ANSWER" ||
    status === "CANCELLED"
  );
}
