import type {
  AgentEnvironment,
  AgentStatus,
  AgentType,
  Prisma,
} from "@prisma/client";

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

  findByBranch(companyId: string, branchId: string) {
    return this.prisma.aiAgent.findMany({
      where: { companyId, branchId },
      orderBy: { createdAt: "desc" },
    });
  }

  countByBranch(companyId: string, branchId: string) {
    return this.prisma.aiAgent.count({ where: { companyId, branchId } });
  }

  create(companyId: string, data: Prisma.AiAgentCreateWithoutCompanyInput) {
    return this.prisma.aiAgent.create({
      data: {
        ...data,
        company: { connect: { id: companyId } },
      },
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
  branchId?: string;
};
