import type { BranchStatus, Prisma } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";

export type BranchFilter = {
  search?: string;
  status?: BranchStatus;
  aiEnabled?: boolean;
};

export class BranchesRepository extends BaseRepository {
  private buildWhere(
    companyId: string,
    filter?: BranchFilter,
    scopeWhere?: Prisma.BranchWhereInput,
  ): Prisma.BranchWhereInput {
    const where: Prisma.BranchWhereInput = this.scope(companyId);

    if (filter?.status) {
      where.status = filter.status;
    }

    if (typeof filter?.aiEnabled === "boolean") {
      where.aiEnabled = filter.aiEnabled;
    }

    const search = filter?.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
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
    filter?: BranchFilter,
    scopeWhere?: Prisma.BranchWhereInput,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.branch.findMany({
      where: this.buildWhere(companyId, filter, scopeWhere),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        invitation: true,
      },
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }

  count(companyId: string, filter?: BranchFilter, scopeWhere?: Prisma.BranchWhereInput) {
    return this.prisma.branch.count({
      where: this.buildWhere(companyId, filter, scopeWhere),
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.branch.findFirst({
      where: { id, companyId },
      include: {
        invitation: true,
      },
    });
  }

  findByIds(companyId: string, ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.branch.findMany({
      where: { companyId, id: { in: ids } },
    });
  }

  findAllNames(companyId: string) {
    return this.prisma.branch.findMany({
      where: this.scope(companyId),
      select: { id: true, name: true },
    });
  }

  async countRelations(companyId: string, branchId: string) {
    const [contactsCount, callLogsCount, documentsCount, agentsCount] =
      await Promise.all([
        this.prisma.uploadedContact.count({
          where: { companyId, branchIds: { has: branchId } },
        }),
        this.prisma.callLog.count({ where: { companyId, branchId } }),
        this.prisma.branchDocument.count({ where: { companyId, branchId } }),
        this.prisma.aiAgent.count({ where: { companyId, branchId } }),
      ]);
    return { contactsCount, callLogsCount, documentsCount, agentsCount };
  }

  findAgents(companyId: string, branchId: string) {
    return this.prisma.aiAgent.findMany({
      where: { companyId, branchId },
      orderBy: { createdAt: "desc" },
    });
  }

  create(companyId: string, data: Prisma.BranchCreateWithoutCompanyInput) {
    return this.prisma.branch.create({
      data: {
        ...data,
        company: { connect: { id: companyId } },
      },
      include: {
        invitation: true,
      },
    });
  }

  update(companyId: string, id: string, data: Prisma.BranchUpdateInput) {
    return this.prisma.branch.updateMany({
      where: { id, companyId },
      data,
    });
  }

  async bulkUpdate(
    companyId: string,
    ids: string[],
    data: Prisma.BranchUpdateManyMutationInput,
  ) {
    const result = await this.prisma.branch.updateMany({
      where: { companyId, id: { in: ids } },
      data,
    });
    return result.count;
  }

  findContacts(
    companyId: string,
    branchId: string,
    limit: number,
    after?: string,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;
    return this.prisma.uploadedContact.findMany({
      where: { companyId, branchIds: { has: branchId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });
  }

  findCallLogs(
    companyId: string,
    branchId: string,
    limit: number,
    after?: string,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;
    return this.prisma.callLog.findMany({
      where: { companyId, branchId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit,
      include: {
        lead: { select: { firstName: true, lastName: true, phone: true } },
      },
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });
  }

  findDocuments(companyId: string, branchId: string) {
    return this.prisma.branchDocument.findMany({
      where: { companyId, branchId },
      orderBy: { createdAt: "desc" },
    });
  }

  findActivities(companyId: string, branchId: string, limit: number) {
    return this.prisma.branchActivity.findMany({
      where: { companyId, branchId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  createActivity(
    companyId: string,
    branchId: string,
    data: { type: string; summary: string; actorId?: string; metadata?: Prisma.InputJsonValue },
  ) {
    return this.prisma.branchActivity.create({
      data: {
        companyId,
        branchId,
        type: data.type,
        summary: data.summary,
        actorId: data.actorId,
        metadata: data.metadata ?? {},
      },
    });
  }

  createActivitiesForMany(
    companyId: string,
    branchIds: string[],
    data: { type: string; summary: string; actorId?: string },
  ) {
    return this.prisma.branchActivity.createMany({
      data: branchIds.map((branchId) => ({
        companyId,
        branchId,
        type: data.type,
        summary: data.summary,
        actorId: data.actorId,
      })),
    });
  }
}
