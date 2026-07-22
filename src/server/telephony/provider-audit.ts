import type { Prisma } from "@prisma/client";

export type ProviderRequestEntry = {
  at: string;
  correlationId: string;
  payload: unknown;
};

export type ProviderResponseEntry = {
  at: string;
  correlationId: string;
  httpStatus?: number;
  providerCallId?: string | null;
  payload?: unknown;
  error?: Record<string, unknown>;
};

export type ProviderWebhookEntry = {
  at: string;
  correlationId?: string;
  providerEventId: string;
  payload: unknown;
};

function toArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  if (!value || !Array.isArray(value)) {
    return [];
  }
  return value as T[];
}

export function appendProviderRequest(
  existing: Prisma.JsonValue | null | undefined,
  entry: ProviderRequestEntry,
): Prisma.InputJsonValue {
  return [
    ...toArray<ProviderRequestEntry>(existing),
    entry,
  ] as Prisma.InputJsonValue;
}

export function appendProviderResponse(
  existing: Prisma.JsonValue | null | undefined,
  entry: ProviderResponseEntry,
): Prisma.InputJsonValue {
  return [
    ...toArray<ProviderResponseEntry>(existing),
    entry,
  ] as Prisma.InputJsonValue;
}

export function appendProviderWebhook(
  existing: Prisma.JsonValue | null | undefined,
  entry: ProviderWebhookEntry,
): Prisma.InputJsonValue {
  return [
    ...toArray<ProviderWebhookEntry>(existing),
    entry,
  ] as Prisma.InputJsonValue;
}
