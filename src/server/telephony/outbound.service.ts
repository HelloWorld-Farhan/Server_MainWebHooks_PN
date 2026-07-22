import type { CallStatus } from "@prisma/client";

import prisma from "@/server/lib/prisma";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { generateCorrelationId } from "@/server/telephony/correlation-id";
import { toProviderErrorJson } from "@/server/telephony/dto/provider-error.dto";
import { buildObdProviderOutboundPayload } from "@/server/telephony/dto/outbound-request.dto";
import {
  getObdConfig,
  getObdServiceNumbers,
  type ObdConfig,
} from "@/server/telephony/obd-config";
import {
  appendProviderRequest,
  appendProviderResponse,
} from "@/server/telephony/provider-audit";
import {
  ObdProviderClient,
  obdProviderClient,
} from "@/server/telephony/provider-client";
import {
  logObdError,
  logObdOutbound,
  logObdProviderResponse,
} from "@/server/telephony/telephony-logger";

export type ObdDispatchInput = {
  companyId: string;
  callLogId: string;
  callLogPublicId: string;
  phone: string;
  campaignPublicId?: string;
};

export type ObdDispatchResult = {
  status: Extract<CallStatus, "QUEUED_AT_PROVIDER" | "FAILED">;
  providerCallId: string | null;
  correlationId: string;
};

export class ObdOutboundService {
  private readonly callLogsRepo = new CallLogsRepository(prisma);

  constructor(
    private readonly providerClient: ObdProviderClient = obdProviderClient,
  ) {}

  async dispatch(input: ObdDispatchInput): Promise<ObdDispatchResult> {
    const config = await this.resolveDispatchConfig(input.companyId);
    const existing = await this.callLogsRepo.findByPublicIdForWebhook(
      input.callLogPublicId,
    );
    const correlationId =
      existing?.correlationId ?? generateCorrelationId();

    const requestPayload = buildObdProviderOutboundPayload(
      {
        callid: input.callLogPublicId,
        phone: input.phone,
        correlationId,
        webhookUrl: config.webhookUrl ?? undefined,
      },
      config,
    );

    const providerRequest = appendProviderRequest(existing?.providerRequest, {
      at: new Date().toISOString(),
      correlationId,
      payload: requestPayload,
    });

    await this.callLogsRepo.startProviderDispatch(input.companyId, input.callLogId, {
      correlationId,
      providerRequest,
    });

    logObdOutbound({
      correlationId,
      callLogPublicId: input.callLogPublicId,
      campaignPublicId: input.campaignPublicId,
      companyId: input.companyId,
      phone: input.phone,
    });

    const result = await this.providerClient.sendOutboundCall(
      {
        callid: input.callLogPublicId,
        phone: input.phone,
        correlationId,
        webhookUrl: config.webhookUrl ?? undefined,
      },
      { serviceNo: config.serviceNo },
    );

    const refreshed = await this.callLogsRepo.findByPublicIdForWebhook(
      input.callLogPublicId,
    );

    if (result.ok) {
      const providerResponse = appendProviderResponse(
        refreshed?.providerResponse,
        {
          at: new Date().toISOString(),
          correlationId,
          httpStatus: 200,
          providerCallId: result.providerCallId,
          payload: result.raw,
        },
      );

      await this.callLogsRepo.completeProviderDispatchSuccess(
        input.companyId,
        input.callLogId,
        {
          providerCallId: result.providerCallId,
          providerResponse,
        },
      );

      logObdProviderResponse({
        correlationId,
        httpStatus: 200,
        providerCallId: result.providerCallId,
      });

      return {
        status: "QUEUED_AT_PROVIDER",
        providerCallId: result.providerCallId,
        correlationId,
      };
    }

    const providerResponse = appendProviderResponse(refreshed?.providerResponse, {
      at: new Date().toISOString(),
      correlationId,
      httpStatus: result.error.httpStatus,
      error: toProviderErrorJson(result.error),
    });

    await this.callLogsRepo.completeProviderDispatchFailure(
      input.companyId,
      input.callLogId,
      { providerResponse },
    );

    logObdError({
      correlationId,
      message: result.error.message,
      httpStatus: result.error.httpStatus,
    });

    return {
      status: "FAILED",
      providerCallId: null,
      correlationId,
    };
  }

  private async resolveDispatchConfig(companyId: string): Promise<ObdConfig> {
    const config = getObdConfig();
    const setup = await prisma.companySetupConfig.findUnique({
      where: { companyId },
      select: { serviceNumber: true },
    });

    const configuredNumber = setup?.serviceNumber?.trim();
    if (
      configuredNumber &&
      getObdServiceNumbers().includes(configuredNumber)
    ) {
      return { ...config, serviceNo: configuredNumber };
    }

    return config;
  }
}

export const obdOutboundService = new ObdOutboundService();
