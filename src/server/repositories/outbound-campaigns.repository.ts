import { BaseRepository } from "@/server/repositories/base.repository";

export class OutboundCampaignsRepository extends BaseRepository {
  findMany(companyId: string) {
    return this.prisma.outboundCampaign.findMany({
      where: this.scope(companyId),
      include: {
        aiAgent: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.outboundCampaign.findFirst({
      where: { id, companyId },
      include: {
        aiAgent: { select: { id: true, name: true } },
      },
    });
  }

  create(
    companyId: string,
    data: { name: string; aiAgentId?: string | null },
  ) {
    return this.prisma.outboundCampaign.create({
      data: {
        companyId,
        name: data.name,
        aiAgentId: data.aiAgentId ?? null,
        status: "DRAFT",
      },
      include: {
        aiAgent: { select: { id: true, name: true } },
      },
    });
  }

  updateStatus(companyId: string, id: string, status: "ACTIVE" | "PAUSED" | "DRAFT" | "COMPLETED") {
    return this.prisma.outboundCampaign.updateMany({
      where: { id, companyId },
      data: { status },
    });
  }
}
