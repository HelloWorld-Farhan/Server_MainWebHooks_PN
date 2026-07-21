import type {
  PhoneNumberStatus,
  Prisma,
  TelephonyProvider,
} from "@prisma/client";

import { decodeIdCursor } from "@/server/lib/pagination";
import { BaseRepository } from "@/server/repositories/base.repository";

const agentSelect = {
  id: true,
  name: true,
} as const;

export type PhoneNumberFilter = {
  number?: string;
  numberContains?: string;
  labelContains?: string;
  search?: string;
  provider?: TelephonyProvider;
  status?: PhoneNumberStatus;
  inboundAgentId?: string;
  outboundAgentId?: string;
  hasInboundAgent?: boolean;
  hasOutboundAgent?: boolean;
  channelIndex?: number;
  hasChannelAssignment?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  lastActivityFrom?: Date;
  lastActivityTo?: Date;
  ids?: string[];
};

export type PhoneNumberSortField =
  | "CREATED_AT"
  | "UPDATED_AT"
  | "LAST_ACTIVITY_AT"
  | "NUMBER"
  | "INBOUND_CALLS_COUNT"
  | "OUTBOUND_CALLS_COUNT";

export type PhoneNumberSort = {
  field: PhoneNumberSortField;
  direction: "ASC" | "DESC";
};

export class PhoneNumbersRepository extends BaseRepository {
  private buildWhere(
    companyId: string,
    filter?: PhoneNumberFilter,
  ): Prisma.PhoneNumberWhereInput {
    const where: Prisma.PhoneNumberWhereInput = this.scope(companyId);
    const and: Prisma.PhoneNumberWhereInput[] = [];

    if (filter?.number) {
      where.number = filter.number.trim();
    }

    if (filter?.numberContains?.trim()) {
      and.push({
        number: { contains: filter.numberContains.trim() },
      });
    }

    if (filter?.labelContains?.trim()) {
      and.push({
        label: {
          contains: filter.labelContains.trim(),
          mode: "insensitive",
        },
      });
    }

    if (filter?.search?.trim()) {
      const term = filter.search.trim();
      and.push({
        OR: [
          { number: { contains: term } },
          { label: { contains: term, mode: "insensitive" } },
        ],
      });
    }

    if (filter?.provider) where.provider = filter.provider;
    if (filter?.status) where.status = filter.status;

    if (filter?.inboundAgentId) {
      where.inboundAgentId = filter.inboundAgentId;
    } else if (typeof filter?.hasInboundAgent === "boolean") {
      where.inboundAgentId = filter.hasInboundAgent ? { not: null } : null;
    }

    if (filter?.outboundAgentId) {
      where.outboundAgentId = filter.outboundAgentId;
    } else if (typeof filter?.hasOutboundAgent === "boolean") {
      where.outboundAgentId = filter.hasOutboundAgent ? { not: null } : null;
    }

    if (typeof filter?.channelIndex === "number") {
      and.push({
        channelAssignments: {
          some: { channelIndex: filter.channelIndex },
        },
      });
    }

    if (typeof filter?.hasChannelAssignment === "boolean") {
      and.push({
        channelAssignments: filter.hasChannelAssignment
          ? { some: {} }
          : { none: {} },
      });
    }

    if (filter?.createdFrom || filter?.createdTo) {
      where.createdAt = {};
      if (filter.createdFrom) where.createdAt.gte = filter.createdFrom;
      if (filter.createdTo) where.createdAt.lte = filter.createdTo;
    }

    if (filter?.lastActivityFrom || filter?.lastActivityTo) {
      where.lastActivityAt = {};
      if (filter.lastActivityFrom) {
        where.lastActivityAt.gte = filter.lastActivityFrom;
      }
      if (filter.lastActivityTo) {
        where.lastActivityAt.lte = filter.lastActivityTo;
      }
    }

    if (filter?.ids && filter.ids.length > 0) {
      where.id = { in: filter.ids };
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  private buildOrderBy(
    sort?: PhoneNumberSort,
  ): Prisma.PhoneNumberOrderByWithRelationInput[] {
    const direction = sort?.direction === "ASC" ? "asc" : "desc";
    const field = sort?.field ?? "CREATED_AT";

    const primary: Prisma.PhoneNumberOrderByWithRelationInput = (() => {
      switch (field) {
        case "UPDATED_AT":
          return { updatedAt: direction };
        case "LAST_ACTIVITY_AT":
          return { lastActivityAt: direction };
        case "NUMBER":
          return { number: direction };
        case "INBOUND_CALLS_COUNT":
          return { inboundCallsCount: direction };
        case "OUTBOUND_CALLS_COUNT":
          return { outboundCallsCount: direction };
        case "CREATED_AT":
        default:
          return { createdAt: direction };
      }
    })();

    return [primary, { id: direction }];
  }

  findMany(companyId: string, filter?: PhoneNumberFilter, sort?: PhoneNumberSort) {
    return this.prisma.phoneNumber.findMany({
      where: this.buildWhere(companyId, filter),
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
      orderBy: this.buildOrderBy(sort),
    });
  }

  findConnection(
    companyId: string,
    limit: number,
    after?: string,
    filter?: PhoneNumberFilter,
    sort?: PhoneNumberSort,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.phoneNumber.findMany({
      where: this.buildWhere(companyId, filter),
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
      orderBy: this.buildOrderBy(sort),
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }

  count(companyId: string, filter?: PhoneNumberFilter) {
    return this.prisma.phoneNumber.count({
      where: this.buildWhere(companyId, filter),
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.phoneNumber.findFirst({
      where: { id, companyId },
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
    });
  }

  findByIds(companyId: string, ids: string[]) {
    return this.prisma.phoneNumber.findMany({
      where: { companyId, id: { in: ids } },
      select: {
        id: true,
        number: true,
        label: true,
      },
    });
  }

  create(
    companyId: string,
    data: {
      number: string;
      provider: TelephonyProvider;
      label?: string;
      inboundAgentId?: string;
      outboundAgentId?: string;
    },
  ) {
    return this.prisma.phoneNumber.create({
      data: {
        number: data.number,
        provider: data.provider,
        label: data.label,
        company: { connect: { id: companyId } },
        ...(data.inboundAgentId
          ? { inboundAgent: { connect: { id: data.inboundAgentId } } }
          : {}),
        ...(data.outboundAgentId
          ? { outboundAgent: { connect: { id: data.outboundAgentId } } }
          : {}),
      },
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
    });
  }

  update(
    companyId: string,
    id: string,
    data: Prisma.PhoneNumberUpdateInput,
  ) {
    return this.prisma.phoneNumber.update({
      where: { id },
      data,
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
    });
  }
}
