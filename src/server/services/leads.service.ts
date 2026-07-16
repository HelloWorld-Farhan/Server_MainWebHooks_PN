import type { LeadTemperature } from "@prisma/client";

import { cacheService } from "@/server/cache/cache.service";
import { NotFoundError } from "@/server/lib/errors";
import {
  buildConnection,
  encodeIdCursor,
} from "@/server/lib/pagination";
import prisma from "@/server/lib/prisma";
import {
  LeadsRepository,
  type LeadFilter,
  type LeadImportRow,
} from "@/server/repositories/leads.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { eventsService } from "@/server/services/events.service";
import { branchAccessService } from "@/server/services/branch-access.service";
import { tenantService } from "@/server/services/tenant.service";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const MAX_IMPORT_ROWS = 1000;

function parseTemperature(value: string): LeadTemperature | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "HOT" || normalized === "WARM" || normalized === "COLD") {
    return normalized;
  }
  return null;
}

function mapLead(
  lead: Awaited<ReturnType<LeadsRepository["findConnection"]>>[number],
) {
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    temperature: lead.temperature,
    score: lead.score,
    lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    sourceName: lead.source?.name ?? null,
    stageName: lead.stage?.name ?? null,
  };
}

export class LeadsService {
  private readonly repo = new LeadsRepository(prisma);

  async getConnection(
    ctx: TenantContext,
    args: {
      first?: number;
      after?: string;
      filter?: LeadFilter;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_READ);

    const limit = Math.min(args.first ?? 20, 100);
    const scopeWhere = branchAccessService.branchRelationFilter(ctx);
    const items = await this.repo.findConnection(
      ctx.companyId,
      limit,
      args.after,
      args.filter,
      scopeWhere,
    );

    const connection = buildConnection(items, limit, (item) =>
      encodeIdCursor(item.id, item.createdAt),
    );

    return {
      ...connection,
      edges: connection.edges.map(({ node, cursor }) => ({
        cursor,
        node: mapLead(node),
      })),
    };
  }

  async getById(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_READ);

    const lead = await this.repo.findById(ctx.companyId, id);
    if (!lead) {
      throw new NotFoundError("Lead not found");
    }
    branchAccessService.assertLeadBranchAccess(ctx, lead.branchId);

    return {
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      temperature: lead.temperature,
      score: lead.score,
      lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
      sourceName: lead.source?.name ?? null,
      stageName: lead.stage?.name ?? null,
    };
  }

  async getTemperatureBreakdown(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_READ);

    const groups = await this.repo.countByTemperature(
      ctx.companyId,
      branchAccessService.branchRelationFilter(ctx),
    );
    const breakdown = { hot: 0, warm: 0, cold: 0, total: 0 };

    for (const group of groups) {
      const count = group._count.id;
      breakdown.total += count;
      if (group.temperature === "HOT") breakdown.hot = count;
      if (group.temperature === "WARM") breakdown.warm = count;
      if (group.temperature === "COLD") breakdown.cold = count;
    }

    return breakdown;
  }

  async importRows(
    ctx: TenantContext,
    rows: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone: string;
      temperature: string;
    }[],
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_WRITE);

    const stats = {
      hot: 0,
      warm: 0,
      cold: 0,
      total: 0,
      invalid: 0,
      created: 0,
      updated: 0,
    };

    const validRows: LeadImportRow[] = [];

    for (const row of rows.slice(0, MAX_IMPORT_ROWS)) {
      const phone = row.phone.trim();
      if (!E164_REGEX.test(phone)) {
        stats.invalid++;
        continue;
      }

      const temperature = parseTemperature(row.temperature);
      if (!temperature) {
        stats.invalid++;
        continue;
      }

      validRows.push({
        firstName: row.firstName?.trim() || null,
        lastName: row.lastName?.trim() || null,
        email: row.email?.trim() || null,
        phone,
        temperature,
      });
    }

    const importStats = await this.repo.importRows(ctx.companyId, validRows);

    await eventsService.emit(ctx, {
      type: "LEAD_CREATED",
      entityType: "lead_import",
      title: `${importStats.created} leads imported from CSV`,
      payload: {
        created: importStats.created,
        updated: importStats.updated,
        invalid: stats.invalid + importStats.invalid,
        total: importStats.total,
      },
    });

    await cacheService.invalidateLeadPages(ctx.companyId);

    return {
      ...importStats,
      invalid: stats.invalid + importStats.invalid,
    };
  }
}

export const leadsService = new LeadsService();

export type { LeadFilter };
