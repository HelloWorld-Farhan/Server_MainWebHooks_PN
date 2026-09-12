import type { CallStatus } from "@prisma/client";

import { normalizeStoredContactPhone } from "@/lib/contact-phone-validation";
import prisma from "@/server/lib/prisma";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { generateCorrelationId } from "@/server/telephony/correlation-id";
import { toProviderErrorJson } from "@/server/telephony/dto/provider-error.dto";
import {
  buildObdProviderOutboundPayload,
  type ObdOutboundContactFields,
  type ObdOutboundCallInput,
} from "@/server/telephony/dto/outbound-request.dto";
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
    const contactFields = await this.resolveContactFields(
      input.companyId,
      input.phone,
    );

    const callInput: ObdOutboundCallInput = {
      callid: input.callLogPublicId,
      phone: input.phone,
      correlationId,
      contactFields,
    };

    const requestPayload = buildObdProviderOutboundPayload(callInput, config);

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
      payload: requestPayload,
    });

    const result = await this.providerClient.sendOutboundCall(callInput, config);

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
      responseBody: result.error.responseBody,
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
      select: { serviceNumber: true, ivrTemplateId: true },
    });

    let resolved = config;

    const configuredNumber = setup?.serviceNumber?.trim();
    if (configuredNumber) {
      resolved = { ...resolved, serviceNo: configuredNumber };
      
      const phoneNumber = await prisma.phoneNumber.findFirst({
        where: { 
          number: { endsWith: configuredNumber }
        },
        select: { agentUrl: true },
      });
      
      if (phoneNumber?.agentUrl) {
        resolved = { ...resolved, voicebotUrl: phoneNumber.agentUrl };
      } else {
        throw new Error(`No Agent URL assigned to DID ${configuredNumber}. Please assign a Voicebot URL in the Admin Panel.`);
      }
    }

    return resolved;
  }

  private async resolveContactFields(
    companyId: string,
    phone: string,
  ): Promise<ObdOutboundContactFields> {
    const storedPhone = normalizeStoredContactPhone(phone);
    const e164Phone = storedPhone ? `+${storedPhone}` : null;
    const phoneCandidates = [...new Set([storedPhone, e164Phone, phone.trim()].filter(Boolean))] as string[];

    if (phoneCandidates.length === 0) {
      return {};
    }

    const contact = await prisma.uploadedContact.findFirst({
      where: {
        companyId,
        phone: { in: phoneCandidates },
      },
      select: {
        field1: true,
        field2: true,
        field3: true,
      },
    });

    if (!contact) {
      return {};
    }

    return {
      userName: contact.field1,
      recordingUrl: contact.field2,
      transcripts: contact.field3,
    };
  }
}

export const obdOutboundService = new ObdOutboundService();
