import type { CallStatus } from "@prisma/client";

import { getChannelCooldownMs } from "@/server/channels/channel-keys";
import { wakeCompanyQueue } from "@/server/channels/channel-queue.hooks";
import { channelService } from "@/server/channels/channel.service";
import {
  incrementChannelMetric,
  logChannelEvent,
  recordQueueWaitMs,
} from "@/server/channels/channel-metrics";
import { assertChannelRedisReady, isRedisDisabled } from "@/server/cache/redis.client";
import { ValidationError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import {
  canTransitionCallStatus,
  isProviderCompletedStatus,
  isTerminalCallStatus,
} from "@/server/telephony/call-status-lifecycle";
import { mapProviderStatusToCallStatus } from "@/server/telephony/status-mapper";
import { obdOutboundService } from "@/server/telephony/outbound.service";

const MAX_DISPATCH_RETRIES = 3;

const ACTIVE_CHANNEL_STATUSES: CallStatus[] = [
  "DISPATCHING",
  "QUEUED_AT_PROVIDER",
  "RINGING",
  "ANSWERED",
];

export type RequestDispatchInput = {
  companyId: string;
  callLogId: string;
  callLogPublicId: string;
  phone: string;
  campaignPublicId?: string;
};

export type RequestDispatchResult = {
  status: Extract<CallStatus, "QUEUED" | "QUEUED_AT_PROVIDER" | "FAILED">;
};

export type HandleProviderWebhookInput = {
  companyId: string;
  callLogId: string;
  currentStatus: CallStatus;
  providerStatus: string;
  durationSeconds?: number;
  answeredAt?: Date;
  endedAt?: Date;
  disconnectReason?: string;
  providerWebhook: import("@prisma/client").Prisma.InputJsonValue;
};

export class CallService {
  private readonly callLogsRepo = new CallLogsRepository(prisma);

  async requestDispatch(
    input: RequestDispatchInput,
  ): Promise<RequestDispatchResult> {
    const callLog = await this.callLogsRepo.findByIdForDispatch(
      input.companyId,
      input.callLogId,
    );
    if (!callLog) {
      throw new ValidationError("Call log not found");
    }
    if (callLog.status !== "PENDING") {
      throw new ValidationError(
        `Call log must be PENDING to dispatch (current: ${callLog.status})`,
      );
    }

    // TEMP: skip Redis channel reservation so calls dial immediately.
    if (isRedisDisabled()) {
      logChannelEvent("channels:bypass", {
        companyId: input.companyId,
        callLogId: input.callLogId,
        reason: "REDIS_ENABLED=false",
      });
      return this.dispatchDirect(input);
    }

    assertChannelRedisReady();
    await this.ensureChannelState(input.companyId);

    const allocated = await this.getAllocatedChannels(input.companyId);
    if (allocated <= 0) {
      return this.queueCall(input.companyId, input.callLogId);
    }

    const reserved = await channelService.tryReserve(input.companyId);
    if (!reserved) {
      return this.queueCall(input.companyId, input.callLogId);
    }

    logChannelEvent("channels:reserved", {
      companyId: input.companyId,
      callLogId: input.callLogId,
    });

    return this.dispatchWithReservedChannel(input);
  }

  async dispatchQueuedCall(callLogId: string): Promise<boolean> {
    if (!/^[a-fA-F0-9]{24}$/.test(callLogId)) {
      return false;
    }

    let callLog: {
      id: string;
      companyId: string;
      publicId: string;
      createdAt: Date;
      phoneNumber: { number: string } | null;
      campaign: { resourceKey: string } | null;
    } | null;

    try {
      callLog = await prisma.callLog.findFirst({
        where: { id: callLogId, status: "QUEUED" },
        select: {
          id: true,
          companyId: true,
          publicId: true,
          createdAt: true,
          phoneNumber: { select: { number: true } },
          campaign: { select: { resourceKey: true } },
        },
      });
    } catch {
      return false;
    }

    if (!callLog?.phoneNumber?.number) {
      return false;
    }

    const lockAcquired = await channelService.acquireDispatchLock(callLog.id);
    if (!lockAcquired) {
      return false;
    }

    try {
      const result = await obdOutboundService.dispatch({
        companyId: callLog.companyId,
        callLogId: callLog.id,
        callLogPublicId: callLog.publicId,
        phone: callLog.phoneNumber.number,
      });

      if (result.status === "FAILED") {
        const retryCount = await this.incrementRetryCount(
          callLog.companyId,
          callLog.id,
        );
        if (retryCount < MAX_DISPATCH_RETRIES) {
          await this.callLogsRepo.transitionStatus(
            callLog.companyId,
            callLog.id,
            { from: "FAILED", to: "QUEUED" },
          );
          await channelService.enqueueFront(callLog.companyId, callLog.id);
        }
        return false;
      }

      incrementChannelMetric("calls_dispatched_from_queue_total");
      recordQueueWaitMs(Date.now() - callLog.createdAt.getTime());
      logChannelEvent("channels:dispatch:queued-call", {
        companyId: callLog.companyId,
        callLogId: callLog.id,
      });
      return true;
    } finally {
      await channelService.releaseDispatchLock(callLog.id);
    }
  }

  async handleProviderWebhook(
    input: HandleProviderWebhookInput,
  ): Promise<{ applied: boolean; mappedStatus: CallStatus }> {
    const mappedStatus = mapProviderStatusToCallStatus(input.providerStatus);
    const canTransition = canTransitionCallStatus(
      input.currentStatus,
      mappedStatus,
    );

    if (isTerminalCallStatus(input.currentStatus) || !canTransition) {
      await this.callLogsRepo.appendProviderWebhookOnly(
        input.companyId,
        input.callLogId,
        { providerWebhook: input.providerWebhook },
      );
      return { applied: false, mappedStatus };
    }

    await this.callLogsRepo.updateFromProviderWebhook(
      input.companyId,
      input.callLogId,
      {
        status: mappedStatus,
        providerStatus: input.providerStatus,
        durationSeconds: input.durationSeconds,
        answeredAt: input.answeredAt,
        endedAt: input.endedAt,
        disconnectReason: input.disconnectReason,
        providerWebhook: input.providerWebhook,
        ...(isProviderCompletedStatus(mappedStatus)
          ? { providerCompletedAt: new Date() }
          : {}),
      },
    );

    if (isTerminalCallStatus(mappedStatus)) {
      await channelService.startCooldown(
        input.companyId,
        input.callLogId,
        getChannelCooldownMs(),
      );
    }

    return { applied: true, mappedStatus };
  }

  private async queueCall(
    companyId: string,
    callLogId: string,
  ): Promise<RequestDispatchResult> {
    await this.callLogsRepo.transitionStatus(companyId, callLogId, {
      from: "PENDING",
      to: "QUEUED",
    });
    await channelService.enqueue(companyId, callLogId);
    return { status: "QUEUED" };
  }

  private async dispatchDirect(
    input: RequestDispatchInput,
  ): Promise<RequestDispatchResult> {
    const result = await obdOutboundService.dispatch({
      companyId: input.companyId,
      callLogId: input.callLogId,
      callLogPublicId: input.callLogPublicId,
      phone: input.phone,
      campaignPublicId: input.campaignPublicId,
    });

    if (result.status === "FAILED") {
      return { status: "FAILED" };
    }

    return { status: "QUEUED_AT_PROVIDER" };
  }

  private async dispatchWithReservedChannel(
    input: RequestDispatchInput,
  ): Promise<RequestDispatchResult> {
    const lockAcquired = await channelService.acquireDispatchLock(
      input.callLogId,
    );
    if (!lockAcquired) {
      await channelService.release(input.companyId);
      wakeCompanyQueue(input.companyId);
      return this.queueCall(input.companyId, input.callLogId);
    }

    try {
      const result = await obdOutboundService.dispatch({
        companyId: input.companyId,
        callLogId: input.callLogId,
        callLogPublicId: input.callLogPublicId,
        phone: input.phone,
        campaignPublicId: input.campaignPublicId,
      });

      if (result.status === "FAILED") {
        await channelService.release(input.companyId);
        wakeCompanyQueue(input.companyId);
        return { status: "FAILED" };
      }

      return { status: "QUEUED_AT_PROVIDER" };
    } catch (error) {
      await channelService.release(input.companyId);
      wakeCompanyQueue(input.companyId);
      throw error;
    } finally {
      await channelService.releaseDispatchLock(input.callLogId);
    }
  }

  async markCancelled(companyId: string, callLogId: string): Promise<void> {
    await this.callLogsRepo.transitionStatus(companyId, callLogId, {
      from: "QUEUED",
      to: "CANCELLED",
    });
    await channelService.releaseDispatchLock(callLogId);
  }

  async retryQueuedCall(
    companyId: string,
    callLogId: string,
    retryCount: number,
  ): Promise<void> {
    if (retryCount >= MAX_DISPATCH_RETRIES) {
      await this.callLogsRepo.transitionStatus(companyId, callLogId, {
        from: "QUEUED",
        to: "FAILED",
      });
      return;
    }

    await channelService.enqueueFront(companyId, callLogId);
  }

  private async incrementRetryCount(
    companyId: string,
    callLogId: string,
  ): Promise<number> {
    const callLog = await prisma.callLog.findFirst({
      where: { id: callLogId, companyId },
      select: { providerMetadata: true },
    });
    const metadata =
      callLog?.providerMetadata &&
      typeof callLog.providerMetadata === "object" &&
      !Array.isArray(callLog.providerMetadata)
        ? (callLog.providerMetadata as Record<string, unknown>)
        : {};
    const retryCount = Number(metadata.retryCount ?? 0) + 1;
    await prisma.callLog.updateMany({
      where: { id: callLogId, companyId },
      data: {
        providerMetadata: {
          ...metadata,
          retryCount,
        },
      },
    });
    return retryCount;
  }

  private async getAllocatedChannels(companyId: string): Promise<number> {
    const config = await prisma.companySetupConfig.findUnique({
      where: { companyId },
      select: { totalChannels: true },
    });
    return config?.totalChannels ?? 0;
  }

  private async ensureChannelState(companyId: string): Promise<void> {
    const metrics = await channelService.getMetrics(companyId);
    if (metrics.allocated > 0) {
      return;
    }

    const allocated = await this.getAllocatedChannels(companyId);
    if (allocated <= 0) {
      return;
    }

    const active = await this.callLogsRepo.countByStatuses(
      companyId,
      ACTIVE_CHANNEL_STATUSES,
    );
    const queued = await this.callLogsRepo.findQueuedCallLogIds(companyId);
    await channelService.initializeCompany(
      companyId,
      allocated,
      active,
      queued,
    );
  }
}

export const callService = new CallService();
