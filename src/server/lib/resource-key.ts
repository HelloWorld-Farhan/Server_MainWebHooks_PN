import type { Prisma, PrismaClient } from "@prisma/client";

import { formatResourceKey } from "@/server/lib/public-id";
import { PublicResourceType } from "@/server/lib/public-id/types";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export async function allocateResourceKey(
  tx: TransactionClient,
  companyId: string,
  resourceType: PublicResourceType,
): Promise<string> {
  const existing = await tx.companyResourceSequence.findUnique({
    where: {
      companyId_resourceType: {
        companyId,
        resourceType,
      },
    },
  });

  const nextSequence = (existing?.lastSequence ?? 0) + 1;
  const resourceKey = formatResourceKey(resourceType, nextSequence);

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
      lastSequence: nextSequence,
    },
    update: {
      lastSequence: nextSequence,
    },
  });

  return resourceKey;
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
