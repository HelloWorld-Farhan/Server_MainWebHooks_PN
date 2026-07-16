import type {
  AgentEnvironment,
  AgentStatus,
  AgentType,
  Prisma,
} from "@prisma/client";

import { cacheService } from "@/server/cache/cache.service";
import { CACHE_TTL, cacheKeys } from "@/server/cache/keys";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import {
  AgentsRepository,
  type CreateAgentData,
} from "@/server/repositories/agents.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { branchAccessService } from "@/server/services/branch-access.service";
import { tenantService } from "@/server/services/tenant.service";

function mapAgent(agent: Awaited<ReturnType<AgentsRepository["findById"]>>) {
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    category: agent.category,
    status: agent.status,
    environment: agent.environment,
    enabled: agent.enabled,
    languages: agent.languages,
    firstMessage: agent.firstMessage,
    systemPrompt: agent.systemPrompt,
    voiceConfig: agent.voiceConfig,
    modelConfig: agent.modelConfig,
    transcriberConfig: agent.transcriberConfig,
    serverConfig: agent.serverConfig,
    structuredOutputs: agent.structuredOutputs,
    scorecards: agent.scorecards,
    monitors: agent.monitors,
    demoAudioUrl: agent.demoAudioUrl,
    branchId: agent.branchId,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export class AgentsService {
  private readonly repo = new AgentsRepository(prisma);

  private async assertBranchInCompany(ctx: TenantContext, branchId: string) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, companyId: ctx.companyId },
      select: { id: true },
    });
    if (!branch) throw new ValidationError("Branch not found");
    branchAccessService.assertBranchAccess(ctx, branchId);
  }

  async getStatusSummary(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);

    return cacheService.getOrSet(
      cacheKeys.companyAgentStatus(ctx.companyId),
      CACHE_TTL.AGENT_STATUS,
      async () => {
        const groups = await this.repo.findStatusSummary(ctx.companyId);
        const summary = {
          active: 0,
          inactive: 0,
          total: 0,
        };

        for (const group of groups) {
          const count = group._count.id;
          summary.total += count;
          if (group.status === "ACTIVE") summary.active = count;
          if (group.status === "INACTIVE") summary.inactive = count;
        }

        return summary;
      },
    );
  }

  async list(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);
    const agents = await this.repo.findMany(ctx.companyId);
    return agents.map((agent) => mapAgent(agent)!);
  }

  async getById(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_READ);

    const agent = await this.repo.findById(ctx.companyId, id);
    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    return mapAgent(agent)!;
  }

  async create(ctx: TenantContext, input: CreateAgentData) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    if (input.branchId) {
      await this.assertBranchInCompany(ctx, input.branchId);
    }

    const agent = await this.repo.create(ctx.companyId, {
      name: input.name,
      type: input.type,
      category: input.category,
      status: input.status ?? "ACTIVE",
      environment: input.environment ?? "PRODUCTION",
      enabled: input.enabled ?? true,
      languages: input.languages ?? ["English (US)"],
      firstMessage: input.firstMessage,
      systemPrompt: input.systemPrompt,
      voiceConfig: input.voiceConfig ?? {},
      modelConfig: input.modelConfig ?? {},
      transcriberConfig: input.transcriberConfig ?? {},
      serverConfig: input.serverConfig ?? {},
      structuredOutputs: input.structuredOutputs ?? [],
      scorecards: input.scorecards ?? [],
      monitors: input.monitors ?? [],
      demoAudioUrl: input.demoAudioUrl,
      ...(input.libraryEntryId
        ? { libraryEntry: { connect: { id: input.libraryEntryId } } }
        : {}),
      ...(input.branchId
        ? { branch: { connect: { id: input.branchId } } }
        : {}),
    });

    await cacheService.invalidateCompanyAgentStatus(ctx.companyId);
    await cacheService.invalidateAgentPages(ctx.companyId);
    return mapAgent(agent)!;
  }

  async update(
    ctx: TenantContext,
    id: string,
    input: Partial<CreateAgentData> & {
      status?: AgentStatus;
      enabled?: boolean;
      branchId?: string | null;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.AGENTS_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Agent not found");

    if (input.branchId) {
      await this.assertBranchInCompany(ctx, input.branchId);
    }

    const data: Prisma.AiAgentUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type as AgentType;
    if (input.category !== undefined) data.category = input.category;
    if (input.status !== undefined) data.status = input.status;
    if (input.environment !== undefined) {
      data.environment = input.environment as AgentEnvironment;
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.languages !== undefined) data.languages = input.languages;
    if (input.firstMessage !== undefined) data.firstMessage = input.firstMessage;
    if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt;
    if (input.voiceConfig !== undefined) data.voiceConfig = input.voiceConfig;
    if (input.modelConfig !== undefined) data.modelConfig = input.modelConfig;
    if (input.transcriberConfig !== undefined) {
      data.transcriberConfig = input.transcriberConfig;
    }
    if (input.serverConfig !== undefined) data.serverConfig = input.serverConfig;
    if (input.structuredOutputs !== undefined) {
      data.structuredOutputs = input.structuredOutputs;
    }
    if (input.scorecards !== undefined) data.scorecards = input.scorecards;
    if (input.monitors !== undefined) data.monitors = input.monitors;
    if (input.demoAudioUrl !== undefined) data.demoAudioUrl = input.demoAudioUrl;
    if (input.branchId !== undefined) {
      data.branch = input.branchId
        ? { connect: { id: input.branchId } }
        : { disconnect: true };
    }

    const agent = await this.repo.update(ctx.companyId, id, data);
    await cacheService.invalidateCompanyAgentStatus(ctx.companyId);
    await cacheService.invalidateAgentPages(ctx.companyId);
    return mapAgent(agent)!;
  }
}

export const agentsService = new AgentsService();
