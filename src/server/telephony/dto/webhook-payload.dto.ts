import { z } from "zod";

/** OBD webhook callback payload (extend when API docs are finalized). */
export const obdWebhookPayloadSchema = z
  .object({
    callid: z.string().min(1),
    phone: z.string().min(1),
    status: z.string().min(1),
    duration: z.union([z.number(), z.string()]).optional(),
    event_id: z.string().optional(),
    eventId: z.string().optional(),
    correlation_id: z.string().optional(),
    correlationId: z.string().optional(),
    answered_at: z.string().optional(),
    answeredAt: z.string().optional(),
    ended_at: z.string().optional(),
    endedAt: z.string().optional(),
    disconnect_reason: z.string().optional(),
    disconnectReason: z.string().optional(),
  })
  .passthrough();

export type ObdWebhookPayload = z.infer<typeof obdWebhookPayloadSchema>;

export function validateObdWebhookPayload(
  body: unknown,
): ObdWebhookPayload {
  return obdWebhookPayloadSchema.parse(body);
}

export function parseWebhookDuration(
  duration: number | string | undefined,
): number {
  if (duration === undefined || duration === null || duration === "") {
    return 0;
  }
  const parsed = typeof duration === "number" ? duration : Number(duration);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function resolveProviderEventId(payload: ObdWebhookPayload): string {
  const explicit = payload.event_id ?? payload.eventId;
  if (explicit) {
    return explicit;
  }
  const endedAt = payload.ended_at ?? payload.endedAt ?? "";
  return `${payload.status}:${endedAt}:${payload.duration ?? 0}`;
}

export function parseWebhookTimestamp(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
