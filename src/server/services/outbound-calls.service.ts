import { Prisma } from "@prisma/client";
import type { CallStatus } from "@prisma/client";

import { normalizeE164Phone } from "@/lib/phone-validation";
import { ValidationError } from "@/server/lib/errors";
import { resolveResourceId } from "@/server/lib/public-id/mapper";
import { PublicResourceType } from "@/server/lib/public-id/types";
import prisma from "@/server/lib/prisma";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { PhoneNumbersRepository } from "@/server/repositories/phone-numbers.repository";
import { campaignAccessService } from "@/server/services/campaign-access.service";
import { callService } from "@/server/services/call.service";
import { tenantService } from "@/server/services/tenant.service";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";

export type CreateOutboundCallInput = {
  campaignId: string;
  phoneNumber: string;
};

export type CreateOutboundCallResult = {
  callLogId: string;
  phoneNumberId: string;
  status: "QUEUED" | "QUEUED_AT_PROVIDER" | "FAILED";
};

export type CreateRetryOutboundCallInput = {
  campaignId: string;
  phoneNumber: string;
  parentCallLogId: string;
  retryNumber: number;
  retryReason: CallStatus;
  correlationId?: string;
};

export class OutboundCallsService {
  private readonly phoneNumbersRepo = new PhoneNumbersRepository(prisma);
  private readonly callLogsRepo = new CallLogsRepository(prisma);

  constructor(
    private readonly dispatchService: {
      requestDispatch: typeof callService.requestDispatch;
    } = callService,
  ) {}

  async createOutboundCall(
    ctx: TenantContext,
    input: CreateOutboundCallInput,
  ): Promise<CreateOutboundCallResult> {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_WRITE);

    const campaignPublicId = input.campaignId?.trim();
    if (!campaignPublicId) {
      throw new ValidationError("Campaign ID is required");
    }

    const phoneRaw = input.phoneNumber?.trim();
    if (!phoneRaw) {
      throw new ValidationError("Phone number is required");
    }

    const normalizedPhone = normalizeE164Phone(phoneRaw);
    if (!normalizedPhone) {
      throw new ValidationError("Phone number must be in E.164 format");
    }

    const internalCampaignId = await resolveResourceId(
      ctx,
      campaignPublicId,
      PublicResourceType.CAMPAIGN,
    );

    const campaign = await prisma.campaign.findFirst({
      where: { id: internalCampaignId, companyId: ctx.companyId },
      select: { id: true, resourceKey: true },
    });
    if (!campaign) {
      throw new ValidationError("Campaign not found");
    }

    campaignAccessService.assertCampaignAccess(ctx, campaign.id);

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
      select: { cli: true },
    });
    if (!company?.cli) {
      throw new ValidationError("Company public identity is not configured");
    }

    const { phoneNumber, callLog } = await this.createOutboundCallRecords({
      companyId: ctx.companyId,
      campaignId: campaign.id,
      campaignResourceKey: campaign.resourceKey,
      companyCli: company.cli,
      normalizedPhone,
    });

    const dispatchResult = await this.dispatchService.requestDispatch({
      companyId: ctx.companyId,
      callLogId: callLog.id,
      callLogPublicId: callLog.publicId,
      phone: phoneNumber.number,
      campaignPublicId,
    });

    return {
      callLogId: callLog.publicId,
      phoneNumberId: phoneNumber.publicId,
      status: dispatchResult.status,
    };
  }

  async createRetryOutboundCall(
    ctx: TenantContext,
    input: CreateRetryOutboundCallInput,
  ): Promise<CreateOutboundCallResult> {
    tenantService.requirePermission(ctx, PERMISSIONS.CALL_LOGS_WRITE);

    const campaignPublicId = input.campaignId?.trim();
    if (!campaignPublicId) {
      throw new ValidationError("Campaign ID is required");
    }

    const phoneRaw = input.phoneNumber?.trim();
    if (!phoneRaw) {
      throw new ValidationError("Phone number is required");
    }

    const normalizedPhone = normalizeE164Phone(phoneRaw);
    if (!normalizedPhone) {
      throw new ValidationError("Phone number must be in E.164 format");
    }

    const internalCampaignId = await resolveResourceId(
      ctx,
      campaignPublicId,
      PublicResourceType.CAMPAIGN,
    );

    const campaign = await prisma.campaign.findFirst({
      where: { id: internalCampaignId, companyId: ctx.companyId },
      select: { id: true, resourceKey: true },
    });
    if (!campaign) {
      throw new ValidationError("Campaign not found");
    }

    campaignAccessService.assertCampaignAccess(ctx, campaign.id);

    const parentCall = await prisma.callLog.findFirst({
      where: {
        id: input.parentCallLogId,
        companyId: ctx.companyId,
        campaignId: campaign.id,
      },
      select: { id: true },
    });
    if (!parentCall) {
      throw new ValidationError("Parent call log not found");
    }

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
      select: { cli: true },
    });
    if (!company?.cli) {
      throw new ValidationError("Company public identity is not configured");
    }

    const { phoneNumber, callLog } = await this.createOutboundCallRecords({
      companyId: ctx.companyId,
      campaignId: campaign.id,
      campaignResourceKey: campaign.resourceKey,
      companyCli: company.cli,
      normalizedPhone,
      retryNumber: input.retryNumber,
      parentCallLogId: input.parentCallLogId,
      isRetry: true,
      retryReason: input.retryReason,
      correlationId: input.correlationId,
    });

    const dispatchResult = await this.dispatchService.requestDispatch({
      companyId: ctx.companyId,
      callLogId: callLog.id,
      callLogPublicId: callLog.publicId,
      phone: phoneNumber.number,
      campaignPublicId,
    });

    return {
      callLogId: callLog.publicId,
      phoneNumberId: phoneNumber.publicId,
      status: dispatchResult.status,
    };
  }

  private async createOutboundCallRecords(input: {
    companyId: string;
    campaignId: string;
    campaignResourceKey: string;
    companyCli: string;
    normalizedPhone: string;
    retryNumber?: number;
    parentCallLogId?: string;
    isRetry?: boolean;
    retryReason?: CallStatus;
    correlationId?: string;
  }) {
    try {
      return await prisma.$transaction(async (tx) => {
        let phoneNumber = await this.phoneNumbersRepo.findByCampaignAndNumber(
          tx,
          input.companyId,
          input.campaignId,
          input.normalizedPhone,
        );

        if (!phoneNumber) {
          phoneNumber = await this.phoneNumbersRepo.createForCampaign(
            tx,
            input.companyId,
            input.campaignId,
            input.normalizedPhone,
            input.campaignResourceKey,
            input.companyCli,
          );
        }

        const callLog = await this.callLogsRepo.createOutboundPending(tx, {
          companyId: input.companyId,
          campaignId: input.campaignId,
          phoneNumberId: phoneNumber.id,
          campaignResourceKey: input.campaignResourceKey,
          companyCli: input.companyCli,
          retryNumber: input.retryNumber,
          parentCallLogId: input.parentCallLogId,
          isRetry: input.isRetry,
          retryReason: input.retryReason,
          correlationId: input.correlationId,
        });

        return { phoneNumber, callLog };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return prisma.$transaction(async (tx) => {
          const phoneNumber = await this.phoneNumbersRepo.findByCampaignAndNumber(
            tx,
            input.companyId,
            input.campaignId,
            input.normalizedPhone,
          );

          if (!phoneNumber) {
            throw error;
          }

          const callLog = await this.callLogsRepo.createOutboundPending(tx, {
            companyId: input.companyId,
            campaignId: input.campaignId,
            phoneNumberId: phoneNumber.id,
            campaignResourceKey: input.campaignResourceKey,
            companyCli: input.companyCli,
            retryNumber: input.retryNumber,
            parentCallLogId: input.parentCallLogId,
            isRetry: input.isRetry,
            retryReason: input.retryReason,
            correlationId: input.correlationId,
          });

          return { phoneNumber, callLog };
        });
      }

      throw error;
    }
  }
}

export const outboundCallsService = new OutboundCallsService();
