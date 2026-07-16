import type { Prisma, SystemEventType } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";

export class EventsRepository extends BaseRepository {
  listRecent(companyId: string, limit: number) {
    return this.prisma.systemEvent.findMany({
      where: this.scope(companyId),
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  create(
    companyId: string,
    data: {
      type: SystemEventType;
      actorId?: string;
      entityType?: string;
      entityId?: string;
      title: string;
      payload?: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.systemEvent.create({
      data: {
        companyId,
        type: data.type,
        actorId: data.actorId,
        entityType: data.entityType,
        entityId: data.entityId,
        title: data.title,
        payload: data.payload ?? {},
      },
    });
  }
}
