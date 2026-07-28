import type { CallDirection, CallStatus, Prisma, PrismaClient } from '@prisma/client';

import { generatePublicId } from '@/server/lib/public-id';
import { PublicResourceType } from '@/server/lib/public-id/types';
import { BaseRepository } from '@/server/repositories/base.repository';
import { decodeCursor } from '@/server/lib/pagination';
import { allocateResourceKey } from '@/server/lib/resource-key';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type CreateOutboundPendingInput = {
  companyId: string;
  campaignId: string;
  phoneNumberId: string;
  campaignResourceKey: string;
  companyCli: string;
  retryNumber?: number;
  parentCallLogId?: string;
  isRetry?: boolean;
  retryReason?: CallStatus;
  correlationId?: string;
};

export type CallLogFilter = {
  direction?: CallDirection;
  status?: CallStatus;
  aiAgentId?: string;
  campaignId?: string;
  phoneNumberId?: string;
  assignedUserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
};

export class CallLogsRepository extends BaseRepository {
  private buildWhere(
    companyId: string,
    filter?: CallLogFilter,
    scopeWhere?: Prisma.CallLogWhereInput,
  ): Prisma.CallLogWhereInput {
    const where: Prisma.CallLogWhereInput = this.scope(companyId);

    if (filter?.direction) where.direction = filter.direction;
    if (filter?.status) where.status = filter.status;
    if (filter?.aiAgentId) where.aiAgentId = filter.aiAgentId;
    if (filter?.campaignId) where.campaignId = filter.campaignId;
    if (filter?.phoneNumberId) where.phoneNumberId = filter.phoneNumberId;
    if (filter?.assignedUserId) where.assignedUserId = filter.assignedUserId;

    if (filter?.dateFrom || filter?.dateTo) {
      where.startedAt = {};
      if (filter.dateFrom) where.startedAt.gte = filter.dateFrom;
      if (filter.dateTo) where.startedAt.lte = filter.dateTo;
    }

    if (filter?.search) {
      const term = filter.search.trim();
      where.OR = [
        { lead: { firstName: { contains: term, mode: 'insensitive' } } },
        { lead: { lastName: { contains: term, mode: 'insensitive' } } },
        { lead: { phone: { contains: term } } },
        { lead: { email: { contains: term, mode: 'insensitive' } } },
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
    filter?: CallLogFilter,
    scopeWhere?: Prisma.CallLogWhereInput,
  ) {
    const cursor = after ? decodeCursor(after) : undefined;

    return this.prisma.callLog.findMany({
      where: this.buildWhere(companyId, filter, scopeWhere),
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        companyId: true,
        leadId: true,
        aiAgentId: true,
        phoneNumberId: true,
        assignedUserId: true,
        campaignId: true,
        direction: true,
        status: true,
        outcome: true,
        startedAt: true,
        durationSeconds: true,
        recordingUrl: true,
        transcriptUrl: true,
        cost: true,
        creditsUsed: true,
        provider: true,
        aiSummary: true,
        sentiment: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findRecent(
    companyId: string,
    limit: number,
    scopeWhere?: Prisma.CallLogWhereInput,
  ) {
    const where =
      scopeWhere && Object.keys(scopeWhere).length > 0
        ? { AND: [this.scope(companyId), scopeWhere] }
        : this.scope(companyId);
    return this.prisma.callLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        companyId: true,
        leadId: true,
        aiAgentId: true,
        direction: true,
        status: true,
        startedAt: true,
        durationSeconds: true,
      },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.callLog.findFirst({
      where: { id, companyId },
      include: {
        transcript: true,
        lead: true,
        aiAgent: true,
        assignedUser: true,
        phoneNumber: true,
      },
    });
  }

  findForBilling(companyId: string, id: string) {
    return this.prisma.callLog.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        status: true,
        durationSeconds: true,
        creditsUsed: true,
        cost: true,
        campaignId: true,
      },
    });
  }

  updateBilling(
    companyId: string,
    id: string,
    data: { creditsUsed: number; cost: number },
  ) {
    return this.prisma.callLog.updateMany({
      where: { id, companyId },
      data: {
        creditsUsed: data.creditsUsed,
        cost: data.cost,
      },
    });
  }

  countSummary(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
    scopeWhere?: Prisma.CallLogWhereInput,
  ) {
    const where = this.buildWhere(companyId, { dateFrom, dateTo }, scopeWhere);

    return Promise.all([
      this.prisma.callLog.count({ where }),
      this.prisma.callLog.count({
        where: { ...where, status: 'COMPLETED' },
      }),
    ]).then(([totalCalls, connectedCalls]) => ({ totalCalls, connectedCalls }));
  }

  findForTimeSeries(
    companyId: string,
    dateFrom: Date,
    dateTo: Date,
    scopeWhere?: Prisma.CallLogWhereInput,
  ) {
    const where = this.buildWhere(companyId, { dateFrom, dateTo }, scopeWhere);

    return this.prisma.callLog.findMany({
      where,
      select: {
        id: true,
        startedAt: true,
        status: true,
        leadId: true,
        outcome: true,
        aiAgentId: true,
      },
      orderBy: { startedAt: 'asc' },
    });
  }

  updateOutcome(
    companyId: string,
    id: string,
    outcome: string,
    reactivationPlan?: Record<string, unknown> | null,
  ) {
    return this.prisma.callLog.updateMany({
      where: { id, companyId },
      data: {
        outcome: outcome as never,
        ...(reactivationPlan !== undefined
          ? { reactivationPlan: reactivationPlan as never }
          : {}),
      },
    });
  }

  findLeadsByIds(companyId: string, ids: string[]) {
    return this.prisma.lead.findMany({
      where: { companyId, id: { in: ids } },
    });
  }

  findAgentsByIds(companyId: string, ids: string[]) {
    return this.prisma.aiAgent.findMany({
      where: { companyId, id: { in: ids } },
    });
  }

  async createOutboundPending(
    tx: TransactionClient,
    input: CreateOutboundPendingInput,
  ) {
    const callLogId = await allocateResourceKey(
      tx,
      input.companyId,
      PublicResourceType.CALL_LOG,
    );
    const publicId = generatePublicId({
      cli: input.companyCli,
      campaignId: input.campaignResourceKey,
      entityId: callLogId,
    });

    return tx.callLog.create({
      data: {
        companyId: input.companyId,
        campaignId: input.campaignId,
        phoneNumberId: input.phoneNumberId,
        callLogId,
        publicId,
        direction: 'OUTBOUND',
        status: 'PENDING',
        startedAt: new Date(),
        provider: 'obd',
        retryNumber: input.retryNumber ?? 0,
        parentCallLogId: input.parentCallLogId,
        isRetry: input.isRetry ?? false,
        retryReason: input.retryReason,
        correlationId: input.correlationId,
      },
    });
  }

  findByPublicIdForWebhook(publicId: string) {
    return this.prisma.callLog.findFirst({
      where: { publicId },
      select: {
        id: true,
        companyId: true,
        campaignId: true,
        publicId: true,
        status: true,
        correlationId: true,
        durationSeconds: true,
        answeredAt: true,
        endedAt: true,
        providerWebhook: true,
        providerRequest: true,
        providerResponse: true,
        company: { select: { id: true, cli: true } },
        campaign: { select: { id: true, resourceKey: true, companyId: true } },
        phoneNumber: {
          select: { id: true, number: true, campaignId: true, companyId: true },
        },
      },
    });
  }

  findByIdForDispatch(companyId: string, id: string) {
    return this.prisma.callLog.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        status: true,
        publicId: true,
        companyId: true,
      },
    });
  }

  transitionStatus(
    companyId: string,
    callLogId: string,
    input: { from: CallStatus; to: CallStatus },
  ) {
    return this.prisma.callLog.updateMany({
      where: { id: callLogId, companyId, status: input.from },
      data: { status: input.to },
    });
  }

  appendProviderWebhookOnly(
    companyId: string,
    callLogId: string,
    data: { providerWebhook: Prisma.InputJsonValue },
  ) {
    return this.prisma.callLog.updateMany({
      where: { id: callLogId, companyId },
      data: { providerWebhook: data.providerWebhook },
    });
  }

  updateFromProviderWebhook(
    companyId: string,
    callLogId: string,
    data: {
      status: CallStatus;
      providerStatus: string;
      durationSeconds?: number;
      answeredAt?: Date;
      endedAt?: Date;
      disconnectReason?: string;
      providerWebhook: Prisma.InputJsonValue;
      providerCompletedAt?: Date;
    },
  ) {
    return this.prisma.callLog.updateMany({
      where: { id: callLogId, companyId },
      data: {
        status: data.status,
        providerStatus: data.providerStatus,
        ...(data.durationSeconds !== undefined
          ? { durationSeconds: data.durationSeconds }
          : {}),
        ...(data.answeredAt !== undefined ? { answeredAt: data.answeredAt } : {}),
        ...(data.endedAt !== undefined ? { endedAt: data.endedAt } : {}),
        ...(data.disconnectReason !== undefined
          ? { disconnectReason: data.disconnectReason }
          : {}),
        providerWebhook: data.providerWebhook,
        ...(data.providerCompletedAt !== undefined
          ? { providerCompletedAt: data.providerCompletedAt }
          : {}),
      },
    });
  }

  countByStatuses(companyId: string, statuses: CallStatus[]) {
    return this.prisma.callLog.count({
      where: { companyId, status: { in: statuses } },
    });
  }

  async findQueuedCallLogIds(companyId: string): Promise<string[]> {
    const rows = await this.prisma.callLog.findMany({
      where: {
        companyId,
        status: 'QUEUED',
        phoneNumberId: { not: null },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  startProviderDispatch(
    companyId: string,
    callLogId: string,
    data: {
      correlationId: string;
      providerRequest: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.callLog.updateMany({
      where: {
        id: callLogId,
        companyId,
        status: { in: ['PENDING', 'QUEUED'] },
      },
      data: {
        status: 'DISPATCHING',
        correlationId: data.correlationId,
        providerRequest: data.providerRequest,
        providerRequestedAt: new Date(),
        provider: 'obd',
      },
    });
  }

  completeProviderDispatchSuccess(
    companyId: string,
    callLogId: string,
    data: {
      providerCallId: string | null;
      providerResponse: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.callLog.updateMany({
      where: { id: callLogId, companyId },
      data: {
        status: 'QUEUED_AT_PROVIDER',
        providerCallId: data.providerCallId,
        providerResponse: data.providerResponse,
        providerAcceptedAt: new Date(),
      },
    });
  }

  completeProviderDispatchFailure(
    companyId: string,
    callLogId: string,
    data: { providerResponse: Prisma.InputJsonValue },
  ) {
    return this.prisma.callLog.updateMany({
      where: { id: callLogId, companyId },
      data: {
        status: 'FAILED',
        providerResponse: data.providerResponse,
        providerCompletedAt: new Date(),
      },
    });
  }

  async failStaleDispatching(companyId: string, olderThan: Date) {
    const stale = await this.prisma.callLog.findMany({
      where: {
        companyId,
        status: 'DISPATCHING',
        OR: [
          { providerRequestedAt: { lt: olderThan } },
          {
            providerRequestedAt: null,
            updatedAt: { lt: olderThan },
          },
        ],
      },
      select: {
        id: true,
        campaignId: true,
        phoneNumber: { select: { number: true } },
        correlationId: true,
      },
    });
    if (stale.length === 0) {
      return { count: 0, failed: [] as typeof stale };
    }
    const result = await this.prisma.callLog.updateMany({
      where: {
        companyId,
        id: { in: stale.map((row) => row.id) },
        status: 'DISPATCHING',
      },
      data: {
        status: 'FAILED',
        providerCompletedAt: new Date(),
        disconnectReason: 'Stale DISPATCHING cleanup',
      },
    });
    return { count: result.count, failed: stale };
  }

  async failStaleQueuedAtProvider(companyId: string, olderThan: Date) {
    const stale = await this.prisma.callLog.findMany({
      where: {
        companyId,
        status: 'QUEUED_AT_PROVIDER',
        startedAt: { lt: olderThan },
      },
      select: {
        id: true,
        endedAt: true,
        campaignId: true,
        phoneNumber: { select: { number: true } },
        correlationId: true,
      },
    });
    const targets = stale.filter((row) => row.endedAt == null);
    const ids = targets.map((row) => row.id);
    if (ids.length === 0) {
      return { count: 0, failed: [] as typeof targets };
    }
    const result = await this.prisma.callLog.updateMany({
      where: {
        companyId,
        id: { in: ids },
        status: 'QUEUED_AT_PROVIDER',
      },
      data: {
        status: 'FAILED',
        providerCompletedAt: new Date(),
        disconnectReason: 'Stale QUEUED_AT_PROVIDER cleanup (no webhook)',
      },
    });
    return { count: result.count, failed: targets };
  }

  async failOrphanQueuedCalls(companyId: string) {
    const orphans = await this.prisma.callLog.findMany({
      where: {
        companyId,
        status: 'QUEUED',
        phoneNumberId: null,
      },
      select: { id: true },
    });
    if (orphans.length === 0) {
      return { count: 0, ids: [] as string[] };
    }
    const ids = orphans.map((row) => row.id);
    const result = await this.prisma.callLog.updateMany({
      where: {
        companyId,
        id: { in: ids },
        status: 'QUEUED',
      },
      data: {
        status: 'FAILED',
        providerCompletedAt: new Date(),
        disconnectReason: 'Orphan QUEUED cleanup (missing phone number)',
      },
    });
    return { count: result.count, ids };
  }
}
