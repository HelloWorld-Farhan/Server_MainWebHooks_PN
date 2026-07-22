import { z } from "zod";

import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/server/lib/errors";
import {
  inferResourceTypeFromKey,
  parsePublicId,
  validatePublicId,
} from "@/server/lib/public-id";
import { PublicResourceType } from "@/server/lib/public-id/types";
import prisma from "@/server/lib/prisma";
import { CallLogProviderEventsRepository } from "@/server/repositories/call-log-provider-events.repository";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import {
  canTransitionCallStatus,
  isTerminalCallStatus,
} from "@/server/telephony/call-status-lifecycle";
import {
  parseWebhookDuration,
  parseWebhookTimestamp,
  resolveProviderEventId,
  validateObdWebhookPayload,
  type ObdWebhookPayload,
} from "@/server/telephony/dto/webhook-payload.dto";
import {
  getObdConfig,
  resolveWebhookApiKey,
} from "@/server/telephony/obd-config";
import { appendProviderWebhook } from "@/server/telephony/provider-audit";
import { mapProviderStatusToCallStatus } from "@/server/telephony/status-mapper";
import {
  logObdWebhook,
  logObdWebhookDuplicate,
} from "@/server/telephony/telephony-logger";
import { validateWebhookCallLogChain } from "@/server/telephony/webhook-validation";
import { callService } from "@/server/services/call.service";
import { retrySchedulerService } from "@/server/campaign-execution/retry/retry-scheduler.service";

export type ObdWebhookProcessResult = {
  received: true;
  duplicate?: boolean;
  callLogPublicId?: string;
  correlationId?: string;
};

export class ObdWebhookService {
  private readonly callLogsRepo = new CallLogsRepository(prisma);
  private readonly providerEventsRepo = new CallLogProviderEventsRepository(
    prisma,
  );

  assertAuthorized(apiKeyHeader: string | undefined): void {
    const expected = resolveWebhookApiKey(getObdConfig());
    if (!expected) {
      throw new UnauthorizedError("OBD webhook authentication is not configured");
    }
    if (!apiKeyHeader || apiKeyHeader !== expected) {
      throw new UnauthorizedError("Invalid OBD webhook API key");
    }
  }

  async processWebhook(body: unknown): Promise<ObdWebhookProcessResult> {
    const start = performance.now();
    let payload: ObdWebhookPayload;

    try {
      payload = validateObdWebhookPayload(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(
          error.issues[0]?.message ?? "Invalid OBD webhook payload",
        );
      }
      throw error;
    }

    const callid = payload.callid.trim();

    if (!validatePublicId(callid, PublicResourceType.CALL_LOG)) {
      throw new ValidationError("Invalid callid public ID format");
    }

    const parsed = parsePublicId(callid);
    if (!parsed) {
      throw new ValidationError("Invalid callid public ID format");
    }

    const entityId = parsed.entityId;
    if (
      !entityId ||
      inferResourceTypeFromKey(entityId) !== PublicResourceType.CALL_LOG
    ) {
      throw new ValidationError("callid must reference a call log public ID");
    }

    const callLog = await this.callLogsRepo.findByPublicIdForWebhook(callid);
    if (!callLog || !callLog.company) {
      throw new NotFoundError("Call log not found for callid");
    }

    validateWebhookCallLogChain(payload, callLog);

    const providerEventId = resolveProviderEventId(payload);
    const correlationId =
      payload.correlation_id ??
      payload.correlationId ??
      callLog.correlationId ??
      undefined;

    const existingEvent = await this.providerEventsRepo.findExisting(
      callLog.id,
      providerEventId,
    );
    if (existingEvent) {
      logObdWebhookDuplicate({
        correlationId,
        callLogPublicId: callid,
        providerEventId,
        durationMs: Math.round(performance.now() - start),
      });
      return {
        received: true,
        duplicate: true,
        callLogPublicId: callid,
        correlationId,
      };
    }

    const webhookEntry = {
      at: new Date().toISOString(),
      correlationId,
      providerEventId,
      payload,
    };
    const providerWebhook = appendProviderWebhook(
      callLog.providerWebhook,
      webhookEntry,
    );

    const mappedStatus = mapProviderStatusToCallStatus(payload.status);
    const isTerminal = isTerminalCallStatus(callLog.status);
    const canTransition = canTransitionCallStatus(callLog.status, mappedStatus);

    const inserted = await this.providerEventsRepo.tryInsert({
      callLogId: callLog.id,
      providerEventId,
      correlationId,
    });

    if (!inserted) {
      logObdWebhookDuplicate({
        correlationId,
        callLogPublicId: callid,
        providerEventId,
        durationMs: Math.round(performance.now() - start),
      });
      return {
        received: true,
        duplicate: true,
        callLogPublicId: callid,
        correlationId,
      };
    }

    if (isTerminal || !canTransition) {
      await this.callLogsRepo.appendProviderWebhookOnly(
        callLog.companyId,
        callLog.id,
        { providerWebhook },
      );

      logObdWebhook({
        correlationId,
        callLogPublicId: callid,
        providerStatus: payload.status,
        durationSeconds: parseWebhookDuration(payload.duration),
        durationMs: Math.round(performance.now() - start),
      });

      return { received: true, callLogPublicId: callid, correlationId };
    }

    const durationSeconds = parseWebhookDuration(payload.duration);
    const answeredAt =
      parseWebhookTimestamp(payload.answered_at ?? payload.answeredAt) ??
      undefined;
    const endedAt =
      parseWebhookTimestamp(payload.ended_at ?? payload.endedAt) ?? undefined;
    const disconnectReason =
      payload.disconnect_reason ?? payload.disconnectReason ?? undefined;

    const webhookResult = await callService.handleProviderWebhook({
      companyId: callLog.companyId,
      callLogId: callLog.id,
      currentStatus: callLog.status,
      providerStatus: payload.status,
      durationSeconds:
        durationSeconds > callLog.durationSeconds
          ? durationSeconds
          : callLog.durationSeconds,
      answeredAt: answeredAt ?? callLog.answeredAt ?? undefined,
      endedAt: endedAt ?? callLog.endedAt ?? undefined,
      disconnectReason,
      providerWebhook,
    });

    if (!webhookResult.applied) {
      return { received: true, callLogPublicId: callid, correlationId };
    }

    if (
      isTerminalCallStatus(webhookResult.mappedStatus) &&
      callLog.campaignId
    ) {
      await retrySchedulerService.handleTerminalCall({
        companyId: callLog.companyId,
        callLogId: callLog.id,
        campaignId: callLog.campaignId,
        phone: callLog.phoneNumber?.number,
        mappedStatus: webhookResult.mappedStatus,
        correlationId,
      });
    }

    logObdWebhook({
      correlationId,
      callLogPublicId: callid,
      providerStatus: payload.status,
      durationSeconds,
      durationMs: Math.round(performance.now() - start),
    });

    return { received: true, callLogPublicId: callid, correlationId };
  }
}

export const obdWebhookService = new ObdWebhookService();
