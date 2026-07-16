import { BaseRepository } from "@/server/repositories/base.repository";

export class CampaignsRepository extends BaseRepository {
  findMany(companyId: string) {
    return this.prisma.campaign.findMany({
      where: this.scope(companyId),
      include: {
        aiAgent: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
