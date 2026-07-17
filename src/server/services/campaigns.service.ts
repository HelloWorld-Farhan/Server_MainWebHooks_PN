import prisma from "@/server/lib/prisma";
import { CampaignsRepository } from "@/server/repositories/campaigns.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";
import { NotFoundError, ValidationError } from "@/server/lib/errors";

function mapCampaign(row: {
  id: string;
  name: string;
  status: string;
  aiAgentId: string | null;
  aiAgent: { id: string; name: string } | null;
  totalCalls: number;
  connectedCalls: number;
  conversionRate: number;
  generatedLeads: number;
  createdAt: Date;
}) {
  return {
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
  };
}

export class CampaignsService {
  private readonly repo = new CampaignsRepository(prisma);

  async list(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.ANALYTICS_READ);
    const rows = await this.repo.findMany(ctx.companyId);
    return rows.map(mapCampaign);
  }

  async create(
    ctx: TenantContext,
    input: { name: string; aiAgentId?: string | null },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    const name = input.name.trim();
    if (!name) {
      throw new ValidationError("Campaign name is required.");
    }

    const row = await this.repo.create(ctx.companyId, {
      name,
      aiAgentId: input.aiAgentId ?? null,
    });
    return mapCampaign(row);
  }

  async launch(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    const campaign = await this.repo.findById(ctx.companyId, id);
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }
    if (campaign.status === "ACTIVE") {
      return mapCampaign(campaign);
    }

    await this.repo.updateStatus(ctx.companyId, id, "ACTIVE");
    const updated = await this.repo.findById(ctx.companyId, id);
    return mapCampaign(updated!);
  }

  async pause(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    const campaign = await this.repo.findById(ctx.companyId, id);
    if (!campaign) {
      throw new NotFoundError("Campaign not found");
    }

    await this.repo.updateStatus(ctx.companyId, id, "PAUSED");
    const updated = await this.repo.findById(ctx.companyId, id);
    return mapCampaign(updated!);
  }
}

export const campaignsService = new CampaignsService();
