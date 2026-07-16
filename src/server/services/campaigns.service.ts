import prisma from "@/server/lib/prisma";
import { CampaignsRepository } from "@/server/repositories/campaigns.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";

export class CampaignsService {
  private readonly repo = new CampaignsRepository(prisma);

  async list(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.ANALYTICS_READ);
    const rows = await this.repo.findMany(ctx.companyId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      agentId: row.aiAgentId,
      agentName: row.aiAgent?.name ?? "Unassigned",
      totalCalls: row.totalCalls,
      connectedCalls: row.connectedCalls,
      conversionRate: row.conversionRate,
      generatedLeads: row.generatedLeads,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

export const campaignsService = new CampaignsService();
