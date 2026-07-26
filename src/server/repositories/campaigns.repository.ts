import type { CampaignStatus, Prisma } from "@prisma/client";

import { allocateResourceKey } from "@/server/lib/resource-key";
import { PublicResourceType } from "@/server/lib/public-id/types";
import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";

export type CampaignFilter = {
  search?: string;
  status?: CampaignStatus;
  aiEnabled?: boolean;
};

export class CampaignsRepository extends BaseRepository {
  private buildWhere(
    companyId: string,
    filter?: CampaignFilter,
    scopeWhere?: Prisma.CampaignWhereInput,
  ): Prisma.CampaignWhereInput {
    const where: Prisma.CampaignWhereInput = this.scope(companyId);

    if (filter?.status) {
      where.status = filter.status;
    }

    if (typeof filter?.aiEnabled === "boolean") {
      where.aiEnabled = filter.aiEnabled;
    }

    const search = filter?.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    if (scopeWhere && Object.keys(scopeWhere).length > 0) {
      return { AND: [where, scopeWhere] };
    }

    return where;
  }

  findConnection(
    companyId: string,
    limit: number,
    after?: string,
    filter?: CampaignFilter,
    scopeWhere?: Prisma.CampaignWhereInput,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.campaign.findMany({
      where: this.buildWhere(companyId, filter, scopeWhere),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        invitation: true,
      },
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }

  count(companyId: string, filter?: CampaignFilter, scopeWhere?: Prisma.CampaignWhereInput) {
    return this.prisma.campaign.count({
      where: this.buildWhere(companyId, filter, scopeWhere),
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.campaign.findFirst({
      where: { id, companyId },
      include: {
        invitation: true,
      },
    });
  }

  findByIds(companyId: string, ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.campaign.findMany({
      where: { companyId, id: { in: ids } },
    });
  }

  findAllNames(companyId: string) {
    return this.prisma.campaign.findMany({
      where: this.scope(companyId),
      select: { id: true, name: true },
    });
  }

  async countRelations(companyId: string, campaignId: string) {
    const [contactsCount, callLogsCount, documentsCount, agentsCount] =
      await Promise.all([
        this.prisma.uploadedContact.count({
          where: { companyId, campaignIds: { has: campaignId } },
        }),
        this.prisma.callLog.count({ where: { companyId, campaignId } }),
        this.prisma.campaignDocument.count({ where: { companyId, campaignId } }),
        this.prisma.aiAgent.count({ where: { companyId, campaignId } }),
      ]);
    return { contactsCount, callLogsCount, documentsCount, agentsCount };
  }

  findAgents(companyId: string, campaignId: string) {
    return this.prisma.aiAgent.findMany({
      where: { companyId, campaignId },
      orderBy: { createdAt: "desc" },
    });
  }

  create(companyId: string, data: Omit<Prisma.CampaignCreateWithoutCompanyInput, "resourceKey"> & { resourceKey?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const resourceKey =
        data.resourceKey ??
        (await allocateResourceKey(
          tx,
          companyId,
          PublicResourceType.CAMPAIGN,
        ));

      return tx.campaign.create({
        data: {
          ...data,
          resourceKey,
          company: { connect: { id: companyId } },
        },
        include: {
          invitation: true,
        },
      });
    });
  }

  update(companyId: string, id: string, data: Prisma.CampaignUpdateInput) {
    return this.prisma.campaign.updateMany({
      where: { id, companyId },
      data,
    });
  }

  async bulkUpdate(
    companyId: string,
    ids: string[],
    data: Prisma.CampaignUpdateManyMutationInput,
  ) {
    const result = await this.prisma.campaign.updateMany({
      where: { companyId, id: { in: ids } },
      data,
    });
    return result.count;
  }

  /**
   * Permanently delete campaigns and clean related records that do not
   * cascade automatically (MongoDB optional FKs / array membership).
   */
  async deleteByIds(companyId: string, ids: string[]) {
    if (ids.length === 0) {
      return 0;
    }

    await this.prisma.contactRetryJob.deleteMany({
      where: { companyId, campaignId: { in: ids } },
    });

    // Detach call logs from campaigns (keep history).
    await this.prisma.callLog.updateMany({
      where: { companyId, campaignId: { in: ids } },
      data: { campaignId: null },
    });

    // Phone numbers are unique on (companyId, campaignId, number). Nulling
    // campaignId across multiple campaigns collides — delete them instead.
    const phoneNumbers = await this.prisma.phoneNumber.findMany({
      where: { companyId, campaignId: { in: ids } },
      select: { id: true },
    });
    const phoneIds = phoneNumbers.map((row) => row.id);
    if (phoneIds.length > 0) {
      await this.prisma.companyChannel.updateMany({
        where: { companyId, phoneNumberId: { in: phoneIds } },
        data: { phoneNumberId: null },
      });
      await this.prisma.callLog.updateMany({
        where: { companyId, phoneNumberId: { in: phoneIds } },
        data: { phoneNumberId: null },
      });
      await this.prisma.phoneNumber.deleteMany({
        where: { companyId, id: { in: phoneIds } },
      });
    }

    await this.prisma.lead.updateMany({
      where: { companyId, campaignId: { in: ids } },
      data: { campaignId: null },
    });
    await this.prisma.aiAgent.updateMany({
      where: { companyId, campaignId: { in: ids } },
      data: { campaignId: null },
    });

    const contacts = await this.prisma.uploadedContact.findMany({
      where: { companyId, campaignIds: { hasSome: ids } },
      select: { id: true, campaignIds: true },
    });
    const idSet = new Set(ids);
    for (const contact of contacts) {
      await this.prisma.uploadedContact.update({
        where: { id: contact.id },
        data: {
          campaignIds: contact.campaignIds.filter((id) => !idSet.has(id)),
        },
      });
    }

    await this.prisma.campaignExecution.deleteMany({
      where: { companyId, campaignId: { in: ids } },
    });
    await this.prisma.campaignDocument.deleteMany({
      where: { campaignId: { in: ids } },
    });
    await this.prisma.campaignActivity.deleteMany({
      where: { companyId, campaignId: { in: ids } },
    });
    await this.prisma.campaignInvitation.deleteMany({
      where: { companyId, campaignId: { in: ids } },
    });
    await this.prisma.memberCampaignAccess.deleteMany({
      where: { campaignId: { in: ids } },
    });
    await this.prisma.apiKeyCampaignAccess.deleteMany({
      where: { campaignId: { in: ids } },
    });

    const result = await this.prisma.campaign.deleteMany({
      where: { companyId, id: { in: ids } },
    });
    return result.count;
  }

  findContacts(
    companyId: string,
    campaignId: string,
    limit: number,
    after?: string,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;
    return this.prisma.uploadedContact.findMany({
      where: { companyId, campaignIds: { has: campaignId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });
  }

  countContacts(companyId: string, campaignId: string) {
    return this.prisma.uploadedContact.count({
      where: { companyId, campaignIds: { has: campaignId } },
    });
  }

  findContactsForExecution(
    companyId: string,
    campaignId: string,
    limit: number,
    afterContactId?: string,
  ) {
    return this.prisma.uploadedContact.findMany({
      where: { companyId, campaignIds: { has: campaignId } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, phone: true },
      ...(afterContactId
        ? {
            cursor: { id: afterContactId },
            skip: 1,
          }
        : {}),
    });
  }

  findCallLogs(
    companyId: string,
    campaignId: string,
    limit: number,
    after?: string,
  ) {
    const cursor = after ? decodeIdCursor(after) : undefined;
    return this.prisma.callLog.findMany({
      where: { companyId, campaignId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit,
      include: {
        lead: { select: { firstName: true, lastName: true, phone: true } },
        phoneNumber: { select: { number: true, publicId: true } },
      },
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });
  }

  findDocuments(companyId: string, campaignId: string) {
    return this.prisma.campaignDocument.findMany({
      where: { companyId, campaignId },
      orderBy: { createdAt: "desc" },
    });
  }

  findActivities(companyId: string, campaignId: string, limit: number) {
    return this.prisma.campaignActivity.findMany({
      where: { companyId, campaignId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  createActivity(
    companyId: string,
    campaignId: string,
    data: { type: string; summary: string; actorId?: string; metadata?: Prisma.InputJsonValue },
  ) {
    return this.prisma.campaignActivity.create({
      data: {
        companyId,
        campaignId,
        type: data.type,
        summary: data.summary,
        actorId: data.actorId,
        metadata: data.metadata ?? {},
      },
    });
  }

  createActivitiesForMany(
    companyId: string,
    campaignIds: string[],
    data: { type: string; summary: string; actorId?: string },
  ) {
    return this.prisma.campaignActivity.createMany({
      data: campaignIds.map((campaignId) => ({
        companyId,
        campaignId,
        type: data.type,
        summary: data.summary,
        actorId: data.actorId,
      })),
    });
  }
}
