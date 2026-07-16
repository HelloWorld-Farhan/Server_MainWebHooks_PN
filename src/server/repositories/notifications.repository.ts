import type { IntegrationType } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";

export class NotificationsRepository extends BaseRepository {
  listForUser(companyId: string, userId: string, limit: number, after?: string) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.notification.findMany({
      where: { companyId, userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }
}

export class IntegrationsRepository extends BaseRepository {
  findAll(companyId: string) {
    return this.prisma.integration.findMany({
      where: this.scope(companyId),
      orderBy: { type: "asc" },
    });
  }

  findByType(companyId: string, type: IntegrationType) {
    return this.prisma.integration.findFirst({
      where: { companyId, type },
    });
  }
}

export class SchedulerRepository extends BaseRepository {
  listUpcoming(
    companyId: string,
    limit: number,
    leadBranchIds?: string[],
  ) {
    return this.prisma.schedulerEvent.findMany({
      where: {
        companyId,
        startAt: { gte: new Date() },
        status: "SCHEDULED",
        ...(leadBranchIds?.length
          ? { lead: { branchId: { in: leadBranchIds } } }
          : {}),
      },
      orderBy: { startAt: "asc" },
      take: limit,
    });
  }
}
