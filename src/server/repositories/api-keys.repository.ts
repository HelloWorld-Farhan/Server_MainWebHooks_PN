import type {
  ApiKeyEnvironment,
  ApiKeyStatus,
  BranchAccessType,
  Prisma,
} from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";

export type ApiKeyFilter = {
  search?: string;
  status?: ApiKeyStatus;
  environment?: ApiKeyEnvironment;
};

const apiKeyInclude = {
  branchAccess: true,
  createdBy: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ApiKeyInclude;

export type ApiKeyRecord = Prisma.ApiKeyGetPayload<{
  include: typeof apiKeyInclude;
}>;

export class ApiKeysRepository extends BaseRepository {
  private notDeleted(): Prisma.ApiKeyWhereInput {
    return { deletedAt: null };
  }

  private buildWhere(
    companyId: string,
    filter?: ApiKeyFilter,
  ): Prisma.ApiKeyWhereInput {
    const where: Prisma.ApiKeyWhereInput = {
      ...this.scope(companyId),
      ...this.notDeleted(),
    };

    if (filter?.status) where.status = filter.status;
    if (filter?.environment) where.environment = filter.environment;

    const search = filter?.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { keyPrefix: { contains: search, mode: "insensitive" } },
      ];
    }

    return where;
  }

  findConnection(
    companyId: string,
    limit: number,
    after?: string,
    filter?: ApiKeyFilter,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.apiKey.findMany({
      where: this.buildWhere(companyId, filter),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: apiKeyInclude,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }

  count(companyId: string, filter?: ApiKeyFilter) {
    return this.prisma.apiKey.count({
      where: this.buildWhere(companyId, filter),
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.apiKey.findFirst({
      where: { id, companyId, ...this.notDeleted() },
      include: apiKeyInclude,
    });
  }

  findByName(companyId: string, name: string) {
    return this.prisma.apiKey.findFirst({
      where: { companyId, name, ...this.notDeleted() },
    });
  }

  findByKeyId(keyId: string) {
    return this.prisma.apiKey.findFirst({
      where: { keyId, ...this.notDeleted() },
      include: { branchAccess: true },
    });
  }

  create(data: {
    companyId: string;
    name: string;
    description?: string | null;
    keyId: string;
    keyPrefix: string;
    hashedSecret: string;
    environment: ApiKeyEnvironment;
    scopes: string[];
    branchAccessType: BranchAccessType;
    branchIds: string[];
    expiresAt?: Date | null;
    createdById: string;
  }) {
    return this.prisma.apiKey.create({
      data: {
        companyId: data.companyId,
        name: data.name,
        description: data.description ?? null,
        keyId: data.keyId,
        keyPrefix: data.keyPrefix,
        hashedSecret: data.hashedSecret,
        environment: data.environment,
        scopes: data.scopes,
        branchAccessType: data.branchAccessType,
        expiresAt: data.expiresAt ?? null,
        createdById: data.createdById,
        branchAccess:
          data.branchAccessType === "SELECTED" && data.branchIds.length > 0
            ? {
                create: data.branchIds.map((branchId) => ({ branchId })),
              }
            : undefined,
      },
      include: apiKeyInclude,
    });
  }

  async update(
    companyId: string,
    id: string,
    data: Prisma.ApiKeyUpdateInput,
  ): Promise<ApiKeyRecord | null> {
    const existing = await this.findById(companyId, id);
    if (!existing) return null;

    return this.prisma.apiKey.update({
      where: { id },
      data,
      include: apiKeyInclude,
    });
  }

  async replaceBranchAccess(
    companyId: string,
    apiKeyId: string,
    branchAccessType: BranchAccessType,
    branchIds: string[],
  ): Promise<ApiKeyRecord | null> {
    const existing = await this.findById(companyId, apiKeyId);
    if (!existing) return null;

    await this.prisma.apiKeyBranchAccess.deleteMany({ where: { apiKeyId } });

    if (branchAccessType === "SELECTED" && branchIds.length > 0) {
      await this.prisma.apiKeyBranchAccess.createMany({
        data: branchIds.map((branchId) => ({ apiKeyId, branchId })),
      });
    }

    return this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { branchAccessType },
      include: apiKeyInclude,
    });
  }

  softDelete(companyId: string, id: string) {
    return this.prisma.apiKey.updateMany({
      where: { id, companyId, deletedAt: null },
      data: { deletedAt: new Date(), status: "INACTIVE" },
    });
  }

  createAuditLog(data: {
    companyId: string;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    changes: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        companyId: data.companyId,
        userId: data.userId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        changes: data.changes as Prisma.InputJsonValue,
      },
    });
  }

  findBranchesByIds(companyId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.branch.findMany({
      where: {
        companyId,
        id: { in: ids },
        status: { not: "ARCHIVED" },
      },
      select: { id: true, name: true, status: true },
    });
  }

  findAccessibleBranches(companyId: string, branchIds: string[] | null) {
    return this.prisma.branch.findMany({
      where: {
        companyId,
        status: { not: "ARCHIVED" },
        ...(branchIds ? { id: { in: branchIds } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    });
  }
}
