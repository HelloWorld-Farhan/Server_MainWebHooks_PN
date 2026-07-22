import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";

export class CallLogProviderEventsRepository extends BaseRepository {
  findExisting(callLogId: string, providerEventId: string) {
    return this.prisma.callLogProviderEvent.findFirst({
      where: { callLogId, providerEventId },
      select: { id: true },
    });
  }

  async tryInsert(data: {
    callLogId: string;
    providerEventId: string;
    correlationId?: string;
  }): Promise<boolean> {
    try {
      await this.prisma.callLogProviderEvent.create({
        data: {
          callLogId: data.callLogId,
          providerEventId: data.providerEventId,
          correlationId: data.correlationId,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return false;
      }
      throw error;
    }
  }
}

export function createCallLogProviderEventsRepository(
  prisma: PrismaClient,
): CallLogProviderEventsRepository {
  return new CallLogProviderEventsRepository(prisma);
}
