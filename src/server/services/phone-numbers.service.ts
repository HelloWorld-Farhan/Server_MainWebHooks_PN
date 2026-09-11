import type { PhoneNumberStatus, TelephonyProvider } from "@prisma/client";

import { NotFoundError } from "@/server/lib/errors";
import {
  buildConnection,
  encodeIdCursor,
} from "@/server/lib/pagination";
import { cacheService } from "@/server/cache/cache.service";
import prisma from "@/server/lib/prisma";
import {
  PhoneNumbersRepository,
  type PhoneNumberFilter,
  type PhoneNumberSort,
} from "@/server/repositories/phone-numbers.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";

function mapPhoneNumber(row: {
  id: string;
  number: string;
  label: string | null;
  provider: TelephonyProvider;
  status: PhoneNumberStatus;
  inboundAgentId: string | null;
  outboundAgentId: string | null;
  inboundAgent?: { id: string; name: string } | null;
  outboundAgent?: { id: string; name: string } | null;
  inboundCallsCount: number;
  outboundCallsCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    number: row.number,
    label: row.label,
    provider: row.provider,
    status: row.status,
    inboundAgentId: row.inboundAgentId,
    outboundAgentId: row.outboundAgentId,
    inboundAgent: row.inboundAgent,
    outboundAgent: row.outboundAgent,
    inboundCallsCount: row.inboundCallsCount,
    outboundCallsCount: row.outboundCallsCount,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PhoneNumbersService {
  private readonly repo = new PhoneNumbersRepository(prisma);

  async list(
    ctx: TenantContext,
    filter?: PhoneNumberFilter,
    sort?: PhoneNumberSort,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);
    const rows = await this.repo.findMany(ctx.companyId, filter, sort);
    return rows.map(mapPhoneNumber);
  }

  async getConnection(
    ctx: TenantContext,
    args: {
      first?: number;
      after?: string;
      filter?: PhoneNumberFilter;
      sort?: PhoneNumberSort;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);

    const limit = Math.min(Math.max(args.first ?? 25, 1), 200);
    const [rows, totalCount] = await Promise.all([
      this.repo.findConnection(
        ctx.companyId,
        limit,
        args.after,
        args.filter,
        args.sort,
      ),
      this.repo.count(ctx.companyId, args.filter),
    ]);

    const connection = buildConnection(rows, limit, (row) =>
      encodeIdCursor(row.id, row.createdAt),
    );

    return {
      edges: connection.edges.map((edge) => ({
        node: mapPhoneNumber(edge.node),
        cursor: edge.cursor,
      })),
      pageInfo: connection.pageInfo,
      totalCount,
    };
  }

  async getById(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);
    const row = await this.repo.findById(ctx.companyId, id);
    if (!row) throw new NotFoundError("Phone number not found");
    return mapPhoneNumber(row);
  }

  async create(
    ctx: TenantContext,
    input: {
      number: string;
      provider: TelephonyProvider;
      label?: string;
      inboundAgentId?: string;
      outboundAgentId?: string;
      agentUrl?: string;
      channels?: number;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);
    const row = await this.repo.create(ctx.companyId, input);
    await cacheService.invalidatePhoneNumberPages(ctx.companyId);
    return mapPhoneNumber(row);
  }

  async update(
    ctx: TenantContext,
    id: string,
    input: {
      label?: string;
      status?: PhoneNumberStatus;
      inboundAgentId?: string | null;
      outboundAgentId?: string | null;
      agentUrl?: string | null;
      channels?: number | null;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Phone number not found");

    const row = await this.repo.update(ctx.companyId, id, {
      ...(input.label !== undefined && { label: input.label }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.inboundAgentId !== undefined && {
        inboundAgentId: input.inboundAgentId,
      }),
      ...(input.outboundAgentId !== undefined && {
        outboundAgentId: input.outboundAgentId,
      }),
      ...(input.agentUrl !== undefined && { agentUrl: input.agentUrl }),
      ...(input.channels !== undefined && { channels: input.channels }),
    });

    await cacheService.invalidatePhoneNumberPages(ctx.companyId);
    return mapPhoneNumber(row);
  }
}

export const phoneNumbersService = new PhoneNumbersService();
