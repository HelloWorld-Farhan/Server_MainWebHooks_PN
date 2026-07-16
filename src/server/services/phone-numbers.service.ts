import type { PhoneNumberStatus, TelephonyProvider } from "@prisma/client";

import { NotFoundError } from "@/server/lib/errors";
import { cacheService } from "@/server/cache/cache.service";
import prisma from "@/server/lib/prisma";
import { PhoneNumbersRepository } from "@/server/repositories/phone-numbers.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";

function mapPhoneNumber(row: Awaited<
  ReturnType<PhoneNumbersRepository["findMany"]>
>[number]) {
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

  async list(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);
    const rows = await this.repo.findMany(ctx.companyId);
    return rows.map(mapPhoneNumber);
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
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Phone number not found");

    const row = await this.repo.update(ctx.companyId, id, {
      label: input.label,
      status: input.status,
      inboundAgent: input.inboundAgentId
        ? { connect: { id: input.inboundAgentId } }
        : input.inboundAgentId === null
          ? { disconnect: true }
          : undefined,
      outboundAgent: input.outboundAgentId
        ? { connect: { id: input.outboundAgentId } }
        : input.outboundAgentId === null
          ? { disconnect: true }
          : undefined,
    });

    await cacheService.invalidatePhoneNumberPages(ctx.companyId);
    return mapPhoneNumber(row);
  }
}

export const phoneNumbersService = new PhoneNumbersService();
