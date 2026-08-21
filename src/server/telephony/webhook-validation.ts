import { normalizeE164Phone } from "@/lib/phone-validation";
import { ValidationError } from "@/server/lib/errors";
import {
  inferResourceTypeFromKey,
  parsePublicId,
  validatePublicId,
} from "@/server/lib/public-id";
import { PublicResourceType } from "@/server/lib/public-id/types";
import type { ObdWebhookPayload } from "@/server/telephony/dto/webhook-payload.dto";

export type WebhookCallLogContext = {
  id: string;
  companyId: string | null;
  campaignId: string | null;
  publicId: string;
  status: import("@prisma/client").CallStatus;
  correlationId: string | null;
  phoneNumber: {
    id: string;
    number: string;
    campaignId: string | null;
    companyId: string | null;
  } | null;
  campaign: {
    id: string;
    resourceKey: string;
    companyId: string | null;
  } | null;
  company: {
    id: string;
    cli: string;
  };
};

export function validateWebhookCallLogChain(
  payload: ObdWebhookPayload,
  callLog: WebhookCallLogContext,
): void {
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

  if (parsed.cli !== callLog.company.cli) {
    throw new ValidationError("Webhook company does not match call log company");
  }

  if (!callLog.campaign) {
    throw new ValidationError("Call log campaign is missing");
  }

  if (parsed.campaignId !== callLog.campaign.resourceKey) {
    throw new ValidationError(
      "Webhook campaign does not match call log campaign",
    );
  }

  if (callLog.campaignId !== callLog.campaign.id) {
    throw new ValidationError("Call log campaign relationship is invalid");
  }

  if (!callLog.phoneNumber) {
    throw new ValidationError("Call log phone number is missing");
  }

  if (callLog.phoneNumber.companyId !== callLog.companyId) {
    throw new ValidationError(
      "Phone number company does not match call log company",
    );
  }

  if (callLog.phoneNumber.campaignId !== callLog.campaignId) {
    throw new ValidationError(
      "Phone number campaign does not match call log campaign",
    );
  }

  const normalizedWebhookPhone = normalizeE164Phone(payload.phone);
  if (!normalizedWebhookPhone) {
    throw new ValidationError("Invalid phone number in webhook payload");
  }

  if (callLog.phoneNumber.number !== normalizedWebhookPhone) {
    throw new ValidationError(
      "Webhook phone number does not match call log phone number",
    );
  }

  const webhookCorrelationId =
    payload.correlation_id ?? payload.correlationId ?? null;
  if (
    webhookCorrelationId &&
    callLog.correlationId &&
    webhookCorrelationId !== callLog.correlationId
  ) {
    throw new ValidationError(
      "Webhook correlation ID does not match call log correlation ID",
    );
  }
}
