import type { Prisma, PrismaClient } from "@prisma/client";

import {
  formatResourceKey,
  inferResourceTypeFromKey,
} from "@/server/lib/public-id";
import { PublicResourceType } from "@/server/lib/public-id/types";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

function parseSequenceFromResourceKey(
  resourceKey: string,
  resourceType: PublicResourceType,
): number | null {
  if (inferResourceTypeFromKey(resourceKey) !== resourceType) {
    return null;
  }

  const numericPart =
    resourceType === PublicResourceType.CALL_LOG
      ? resourceKey.startsWith("CL")
        ? resourceKey.slice(2)
        : resourceKey
      : resourceKey.slice(2);

  const sequence = Number.parseInt(numericPart, 10);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
}

async function listResourceKeysForType(
  tx: TransactionClient,
  companyId: string,
  resourceType: PublicResourceType,
): Promise<string[]> {
  switch (resourceType) {
    case PublicResourceType.CAMPAIGN:
      return (
        await tx.campaign.findMany({
          where: { companyId },
          select: { resourceKey: true },
        })
      ).map((row) => row.resourceKey);
    case PublicResourceType.AGENT:
      return (
        await tx.aiAgent.findMany({
          where: { companyId },
          select: { resourceKey: true },
        })
      ).map((row) => row.resourceKey);
    case PublicResourceType.CONTACT:
      return (
        await tx.uploadedContact.findMany({
          where: { companyId },
          select: { resourceKey: true },
        })
      ).map((row) => row.resourceKey);
    case PublicResourceType.PHONE_NUMBER:
      return (
        await tx.phoneNumber.findMany({
          where: { companyId },
          select: { phoneNumberId: true },
        })
      ).map((row) => row.phoneNumberId);
    case PublicResourceType.CALL_LOG:
      return (
        await tx.callLog.findMany({
          where: { companyId },
          select: { callLogId: true },
        })
      ).map((row) => row.callLogId);
    default:
      return [];
  }
}

async function getMaxExistingResourceSequence(
  tx: TransactionClient,
  companyId: string,
  resourceType: PublicResourceType,
): Promise<number> {
  const resourceKeys = await listResourceKeysForType(tx, companyId, resourceType);
  let maxSequence = 0;

  for (const resourceKey of resourceKeys) {
    const sequence = parseSequenceFromResourceKey(resourceKey, resourceType);
    if (sequence !== null) {
      maxSequence = Math.max(maxSequence, sequence);
    }
  }

  return maxSequence;
}

async function reserveResourceKeySequences(
  tx: TransactionClient,
  companyId: string,
  resourceType: PublicResourceType,
  count: number,
): Promise<{ startSequence: number; endSequence: number }> {
  const existing = await tx.companyResourceSequence.findUnique({
    where: {
      companyId_resourceType: {
        companyId,
        resourceType,
      },
    },
  });

  const maxExistingSequence = await getMaxExistingResourceSequence(
    tx,
    companyId,
    resourceType,
  );
  const startSequence =
    Math.max(existing?.lastSequence ?? 0, maxExistingSequence) + 1;
  const endSequence = startSequence + count - 1;

  await tx.companyResourceSequence.upsert({
    where: {
      companyId_resourceType: {
        companyId,
        resourceType,
      },
    },
    create: {
      companyId,
      resourceType,
      lastSequence: endSequence,
    },
    update: {
      lastSequence: endSequence,
    },
  });

  return { startSequence, endSequence };
}

export async function allocateResourceKey(
  tx: TransactionClient,
  companyId: string,
  resourceType: PublicResourceType,
): Promise<string> {
  const { startSequence } = await reserveResourceKeySequences(
    tx,
    companyId,
    resourceType,
    1,
  );
  return formatResourceKey(resourceType, startSequence);
}

export async function allocateResourceKeys(
  tx: TransactionClient,
  companyId: string,
  resourceType: PublicResourceType,
  count: number,
): Promise<string[]> {
  if (count <= 0) {
    return [];
  }

  const { startSequence, endSequence } = await reserveResourceKeySequences(
    tx,
    companyId,
    resourceType,
    count,
  );

  const resourceKeys: string[] = [];
  for (let sequence = startSequence; sequence <= endSequence; sequence++) {
    resourceKeys.push(formatResourceKey(resourceType, sequence));
  }

  return resourceKeys;
}

export async function allocateResourceKeyWithPrisma(
  prisma: PrismaClient,
  companyId: string,
  resourceType: PublicResourceType,
): Promise<string> {
  return prisma.$transaction((tx) =>
    allocateResourceKey(tx, companyId, resourceType),
  );
}

export type ResourceKeyCreateData<T> = T & { resourceKey: string };

export function withAllocatedResourceKey<T extends Record<string, unknown>>(
  data: T,
  resourceKey: string,
): ResourceKeyCreateData<T> {
  return { ...data, resourceKey };
}
