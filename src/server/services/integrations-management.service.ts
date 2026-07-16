import type { AgentToolId as PrismaAgentToolId, IntegrationType, Prisma } from "@prisma/client";

import { cacheService } from "@/server/cache/cache.service";
import { NotFoundError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import { IntegrationsRepository } from "@/server/repositories/notifications.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";
import type { IntegrationId } from "@/lib/integrations/types";
import type { AgentToolId } from "@/lib/tools/types";

const INTEGRATION_TYPE_MAP: Record<IntegrationId, IntegrationType> = {
  "google-sheets": "GOOGLE_SHEETS",
  "google-calendar": "GOOGLE_CALENDAR",
  hubspot: "HUBSPOT",
  salesforce: "SALESFORCE",
  email: "EMAIL",
  whatsapp: "WHATSAPP",
};

const INTEGRATION_ID_MAP: Partial<Record<IntegrationType, IntegrationId>> =
  Object.fromEntries(
    Object.entries(INTEGRATION_TYPE_MAP).map(([k, v]) => [v, k as IntegrationId]),
  ) as Partial<Record<IntegrationType, IntegrationId>>;

const TOOL_ID_TO_PRISMA: Record<AgentToolId, PrismaAgentToolId> = {
  faq: "FAQ",
  billing: "BILLING",
  "google-calendar": "GOOGLE_CALENDAR",
  "google-sheets": "GOOGLE_SHEETS",
};

const PRISMA_TO_TOOL_ID: Record<PrismaAgentToolId, AgentToolId> = {
  FAQ: "faq",
  BILLING: "billing",
  GOOGLE_CALENDAR: "google-calendar",
  GOOGLE_SHEETS: "google-sheets",
};

function mapIntegrationStatus(
  status: string,
): "connected" | "not_connected" | "syncing" | "error" {
  switch (status) {
    case "CONNECTED":
      return "connected";
    case "SYNCING":
      return "syncing";
    case "ERROR":
      return "error";
    default:
      return "not_connected";
  }
}

function mapPrismaStatus(
  status: "connected" | "not_connected" | "syncing" | "error",
) {
  switch (status) {
    case "connected":
      return "CONNECTED" as const;
    case "syncing":
      return "SYNCING" as const;
    case "error":
      return "ERROR" as const;
    default:
      return "NOT_CONNECTED" as const;
  }
}

export class IntegrationsManagementService {
  private readonly repo = new IntegrationsRepository(prisma);

  async list(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.INTEGRATIONS_READ);
    const rows = await this.repo.findAll(ctx.companyId);
    return rows.map((row) => ({
      id: INTEGRATION_ID_MAP[row.type] ?? row.type.toLowerCase(),
      type: row.type,
      status: mapIntegrationStatus(row.status),
      connectedAccount: row.connectedAccount,
      config: row.config,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
    }));
  }

  async getByType(ctx: TenantContext, integrationId: IntegrationId) {
    tenantService.requirePermission(ctx, PERMISSIONS.INTEGRATIONS_READ);
    const type = INTEGRATION_TYPE_MAP[integrationId];
    const row = await this.repo.findByType(ctx.companyId, type);
    if (!row) return null;

    return {
      id: integrationId,
      type: row.type,
      status: mapIntegrationStatus(row.status),
      connectedAccount: row.connectedAccount,
      config: row.config,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
    };
  }

  async connect(ctx: TenantContext, integrationId: IntegrationId, account?: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.INTEGRATIONS_WRITE);
    const type = INTEGRATION_TYPE_MAP[integrationId];

    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId: ctx.companyId, type } },
      create: {
        company: { connect: { id: ctx.companyId } },
        type,
        status: "CONNECTED",
        connectedAccount: account ?? null,
        lastSyncAt: new Date(),
      },
      update: {
        status: "CONNECTED",
        connectedAccount: account ?? undefined,
        lastSyncAt: new Date(),
        errorMessage: null,
      },
    });

    await cacheService.invalidateSettingsPages(ctx.companyId);

    return {
      id: integrationId,
      status: mapIntegrationStatus(row.status),
      connectedAccount: row.connectedAccount,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    };
  }

  async disconnect(ctx: TenantContext, integrationId: IntegrationId) {
    tenantService.requirePermission(ctx, PERMISSIONS.INTEGRATIONS_WRITE);
    const type = INTEGRATION_TYPE_MAP[integrationId];

    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId: ctx.companyId, type } },
      create: {
        company: { connect: { id: ctx.companyId } },
        type,
        status: "NOT_CONNECTED",
      },
      update: {
        status: "NOT_CONNECTED",
        connectedAccount: null,
        lastSyncAt: null,
        errorMessage: null,
        config: {},
      },
    });

    await cacheService.invalidateSettingsPages(ctx.companyId);

    return {
      id: integrationId,
      status: mapIntegrationStatus(row.status),
    };
  }

  async updateConfig(
    ctx: TenantContext,
    integrationId: IntegrationId,
    config: Record<string, unknown>,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.INTEGRATIONS_WRITE);
    const type = INTEGRATION_TYPE_MAP[integrationId];

    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId: ctx.companyId, type } },
      create: {
        company: { connect: { id: ctx.companyId } },
        type,
        config: config as Prisma.InputJsonValue,
      },
      update: { config: config as Prisma.InputJsonValue },
    });

    await cacheService.invalidateSettingsPages(ctx.companyId);

    return row.config;
  }

  async getAgentTools(ctx: TenantContext, agentId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);

    const agent = await prisma.aiAgent.findFirst({
      where: { id: agentId, companyId: ctx.companyId },
    });
    if (!agent) throw new NotFoundError("Agent not found");

    const assignments = await prisma.agentToolAssignment.findMany({
      where: { aiAgentId: agentId },
    });

    return assignments.map((row) => ({
      toolId: PRISMA_TO_TOOL_ID[row.toolId],
      enabled: row.enabled,
      config: row.config,
      usage: row.usage,
    }));
  }

  async updateAgentTool(
    ctx: TenantContext,
    agentId: string,
    toolId: AgentToolId,
    data: { enabled?: boolean; config?: Record<string, unknown> },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    const agent = await prisma.aiAgent.findFirst({
      where: { id: agentId, companyId: ctx.companyId },
    });
    if (!agent) throw new NotFoundError("Agent not found");

    const prismaToolId = TOOL_ID_TO_PRISMA[toolId];

    const row = await prisma.agentToolAssignment.upsert({
      where: {
        aiAgentId_toolId: { aiAgentId: agentId, toolId: prismaToolId },
      },
      create: {
        aiAgent: { connect: { id: agentId } },
        toolId: prismaToolId,
        enabled: data.enabled ?? false,
        config: (data.config ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        enabled: data.enabled,
        config: data.config as Prisma.InputJsonValue | undefined,
      },
    });

    await cacheService.invalidateAgentPages(ctx.companyId);

    return {
      toolId: PRISMA_TO_TOOL_ID[row.toolId],
      enabled: row.enabled,
      config: row.config,
      usage: row.usage,
    };
  }
}

export const integrationsManagementService =
  new IntegrationsManagementService();
