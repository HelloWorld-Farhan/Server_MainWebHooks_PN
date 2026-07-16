import type { LeadTemperature, Prisma } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";

export type LeadFilter = {
  dormantOnly?: boolean;
  minDaysInactive?: number;
  temperature?: LeadTemperature;
};

export type LeadImportRow = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone: string;
  temperature: LeadTemperature;
};

export type LeadImportStats = {
  hot: number;
  warm: number;
  cold: number;
  total: number;
  invalid: number;
  created: number;
  updated: number;
};

const DEFAULT_PIPELINE_STAGES = [
  { name: "New", slug: "new", order: 0, isDefault: true },
  { name: "Contacted", slug: "contacted", order: 1, isDefault: false },
  { name: "Qualified", slug: "qualified", order: 2, isDefault: false },
];

export class LeadsRepository extends BaseRepository {
  findById(companyId: string, id: string) {
    return this.prisma.lead.findFirst({
      where: { id, companyId },
      include: {
        stage: true,
        source: true,
        assignedUser: true,
      },
    });
  }

  private buildWhere(
    companyId: string,
    filter?: LeadFilter,
    scopeWhere?: Prisma.LeadWhereInput,
  ): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = this.scope(companyId);

    if (filter?.temperature) {
      where.temperature = filter.temperature;
    }

    if (filter?.dormantOnly || filter?.minDaysInactive) {
      const days = filter.minDaysInactive ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      where.OR = [
        { lastContactedAt: { lt: cutoff } },
        { lastContactedAt: null },
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
    filter?: LeadFilter,
    scopeWhere?: Prisma.LeadWhereInput,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.lead.findMany({
      where: this.buildWhere(companyId, filter, scopeWhere),
      include: {
        source: true,
        stage: true,
        callLogs: {
          orderBy: { startedAt: "desc" },
          take: 1,
          include: { aiAgent: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ lastContactedAt: "asc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }

  countByTemperature(companyId: string, scopeWhere?: Prisma.LeadWhereInput) {
    const where = scopeWhere && Object.keys(scopeWhere).length > 0
      ? { AND: [this.scope(companyId), scopeWhere] }
      : this.scope(companyId);
    return this.prisma.lead.groupBy({
      by: ["temperature"],
      where,
      _count: { id: true },
    });
  }

  create(companyId: string, data: Prisma.LeadCreateWithoutCompanyInput) {
    return this.prisma.lead.create({
      data: {
        ...data,
        company: { connect: { id: companyId } },
      },
    });
  }

  findByPhone(companyId: string, phone: string) {
    return this.prisma.lead.findFirst({
      where: { companyId, phone },
    });
  }

  async ensureImportDefaults(companyId: string) {
    const stage =
      (await this.prisma.leadPipelineStage.findFirst({
        where: { companyId },
        orderBy: [{ isDefault: "desc" }, { order: "asc" }],
      })) ??
      (await this.prisma.leadPipelineStage.create({
        data: {
          companyId,
          ...DEFAULT_PIPELINE_STAGES[0],
        },
      }));

    const source =
      (await this.prisma.leadSource.findFirst({
        where: { companyId, type: "CSV" },
      })) ??
      (await this.prisma.leadSource.create({
        data: {
          companyId,
          name: "CSV Import",
          type: "CSV",
        },
      }));

    return { stageId: stage.id, sourceId: source.id };
  }

  async importRows(
    companyId: string,
    rows: LeadImportRow[],
  ): Promise<LeadImportStats> {
    const stats: LeadImportStats = {
      hot: 0,
      warm: 0,
      cold: 0,
      total: 0,
      invalid: 0,
      created: 0,
      updated: 0,
    };

    const { stageId, sourceId } = await this.ensureImportDefaults(companyId);
    const seenPhones = new Set<string>();

    for (const row of rows) {
      const phone = row.phone.trim();
      if (!phone || seenPhones.has(phone)) {
        stats.invalid++;
        continue;
      }
      seenPhones.add(phone);

      const temperature = row.temperature;
      const score =
        temperature === "HOT" ? 80 : temperature === "WARM" ? 55 : 30;

      if (temperature === "HOT") stats.hot++;
      else if (temperature === "WARM") stats.warm++;
      else stats.cold++;

      stats.total++;

      const existing = await this.findByPhone(companyId, phone);
      if (existing) {
        await this.prisma.lead.update({
          where: { id: existing.id },
          data: {
            firstName: row.firstName ?? existing.firstName,
            lastName: row.lastName ?? existing.lastName,
            email: row.email ?? existing.email,
            temperature,
            score,
            source: { connect: { id: sourceId } },
          },
        });
        stats.updated++;
        continue;
      }

      await this.create(companyId, {
        firstName: row.firstName ?? undefined,
        lastName: row.lastName ?? undefined,
        email: row.email ?? undefined,
        phone,
        temperature,
        score,
        stage: { connect: { id: stageId } },
        source: { connect: { id: sourceId } },
      });
      stats.created++;
    }

    return stats;
  }
}
