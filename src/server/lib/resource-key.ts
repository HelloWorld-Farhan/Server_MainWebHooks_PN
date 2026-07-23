import type { Prisma, PrismaClient } from "@prisma/client";

import { formatResourceKey } from "@/server/lib/public-id";
import { PublicResourceType } from "@/server/lib/public-id/types";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

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

  const startSequence = (existing?.lastSequence ?? 0) + 1;
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
