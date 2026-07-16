import type {
  CallDirection,
  CallStatus,
  Prisma,
} from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeCursor } from "@/server/lib/pagination";

export type CallLogFilter = {
  direction?: CallDirection;
  status?: CallStatus;
  aiAgentId?: string;
  phoneNumberId?: string;
  assignedUserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
};

export class CallLogsRepository extends BaseRepository {
  private buildWhere(
    companyId: string,
    filter?: CallLogFilter,
    scopeWhere?: Prisma.CallLogWhereInput,
  ): Prisma.CallLogWhereInput {
    const where: Prisma.CallLogWhereInput = this.scope(companyId);

    if (filter?.direction) where.direction = filter.direction;
    if (filter?.status) where.status = filter.status;
    if (filter?.aiAgentId) where.aiAgentId = filter.aiAgentId;
    if (filter?.phoneNumberId) where.phoneNumberId = filter.phoneNumberId;
    if (filter?.assignedUserId) where.assignedUserId = filter.assignedUserId;

    if (filter?.dateFrom || filter?.dateTo) {
      where.startedAt = {};
      if (filter.dateFrom) where.startedAt.gte = filter.dateFrom;
      if (filter.dateTo) where.startedAt.lte = filter.dateTo;
    }

    if (filter?.search) {
      const term = filter.search.trim();
      where.OR = [
        { lead: { firstName: { contains: term, mode: "insensitive" } } },
        { lead: { lastName: { contains: term, mode: "insensitive" } } },
        { lead: { phone: { contains: term } } },
        { lead: { email: { contains: term, mode: "insensitive" } } },
      ];
    }

    if (scopeWhere && Object.keys(scopeWhere).length > 0) {
      return { AND: [where, scopeWhere] };
    }

    return where;
  }

  findConnection(
    companyId: string,
    limit: number,
    after?: string,
    filter?: CallLogFilter,
    scopeWhere?: Prisma.CallLogWhereInput,
  ) {
    const cursor = after ? decodeCursor(after) : undefined;

    return this.prisma.callLog.findMany({
      where: this.buildWhere(companyId, filter, scopeWhere),
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        companyId: true,
        leadId: true,
        aiAgentId: true,
        phoneNumberId: true,
        assignedUserId: true,
        direction: true,
        status: true,
        outcome: true,
        startedAt: true,
        durationSeconds: true,
        recordingUrl: true,
        transcriptUrl: true,
        cost: true,
        creditsUsed: true,
        provider: true,
        aiSummary: true,
        sentiment: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findRecent(companyId: string, limit: number, scopeWhere?: Prisma.CallLogWhereInput) {
    const where =
      scopeWhere && Object.keys(scopeWhere).length > 0
        ? { AND: [this.scope(companyId), scopeWhere] }
        : this.scope(companyId);
    return this.prisma.callLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        companyId: true,
        leadId: true,
        aiAgentId: true,
        direction: true,
        status: true,
        startedAt: true,
        durationSeconds: true,
      },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.callLog.findFirst({
      where: { id, companyId },
      include: {
        transcript: true,
        lead: true,
        aiAgent: true,
        assignedUser: true,
        phoneNumber: true,
      },
    });
  }

  countSummary(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
    scopeWhere?: Prisma.CallLogWhereInput,
  ) {
    const where = this.buildWhere(companyId, { dateFrom, dateTo }, scopeWhere);

    return Promise.all([
      this.prisma.callLog.count({ where }),
      this.prisma.callLog.count({
        where: { ...where, status: "COMPLETED" },
      }),
    ]).then(([totalCalls, connectedCalls]) => ({ totalCalls, connectedCalls }));
  }

  findLeadsByIds(companyId: string, ids: string[]) {
    return this.prisma.lead.findMany({
      where: { companyId, id: { in: ids } },
    });
  }

  findAgentsByIds(companyId: string, ids: string[]) {
    return this.prisma.aiAgent.findMany({
      where: { companyId, id: { in: ids } },
    });
  }
}
