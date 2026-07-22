import type {
  AgentEnvironment,
  AgentStatus,
  AgentType,
  Prisma,
} from "@prisma/client";

import { PublicResourceType } from "@/server/lib/public-id/types";
import { allocateResourceKey } from "@/server/lib/resource-key";
import { BaseRepository } from "@/server/repositories/base.repository";

export class AgentsRepository extends BaseRepository {
  findStatusSummary(companyId: string) {
    return this.prisma.aiAgent.groupBy({
      by: ["status"],
      where: this.scope(companyId),
      _count: { id: true },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.aiAgent.findFirst({
      where: { id, companyId },
    });
  }

  findMany(companyId: string) {
    return this.prisma.aiAgent.findMany({
      where: this.scope(companyId),
      orderBy: { createdAt: "desc" },
    });
  }

  findByIds(companyId: string, ids: string[]) {
    return this.prisma.aiAgent.findMany({
      where: { companyId, id: { in: ids } },
    });
  }

  findByCampaign(companyId: string, campaignId: string) {
    return this.prisma.aiAgent.findMany({
      where: { companyId, campaignId },
      orderBy: { createdAt: "desc" },
    });
  }

  countByCampaign(companyId: string, campaignId: string) {
    return this.prisma.aiAgent.count({ where: { companyId, campaignId } });
  }

  create(companyId: string, data: Omit<Prisma.AiAgentCreateWithoutCompanyInput, "resourceKey"> & { resourceKey?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const resourceKey =
        data.resourceKey ??
        (await allocateResourceKey(tx, companyId, PublicResourceType.AGENT));

      return tx.aiAgent.create({
        data: {
          ...data,
          resourceKey,
          company: { connect: { id: companyId } },
        },
      });
    });
  }

  update(
    companyId: string,
    id: string,
    data: Prisma.AiAgentUpdateInput,
  ) {
    return this.prisma.aiAgent.update({
      where: { id },
      data,
    });
  }
}

export type CreateAgentData = {
  name: string;
  type: AgentType;
  category?: string;
  status?: AgentStatus;
  environment?: AgentEnvironment;
  enabled?: boolean;
  languages?: string[];
  firstMessage?: string;
  systemPrompt?: string;
  voiceConfig?: Prisma.InputJsonValue;
  modelConfig?: Prisma.InputJsonValue;
  transcriberConfig?: Prisma.InputJsonValue;
  serverConfig?: Prisma.InputJsonValue;
  structuredOutputs?: Prisma.InputJsonValue;
  scorecards?: Prisma.InputJsonValue;
  monitors?: Prisma.InputJsonValue;
  demoAudioUrl?: string;
  libraryEntryId?: string;
  campaignId?: string;
};
