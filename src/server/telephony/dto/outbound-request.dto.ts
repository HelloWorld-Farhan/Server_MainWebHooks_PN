import { z } from "zod";

import type { ObdConfig } from "@/server/telephony/obd-config";

/** Single phone entry sent to the OBD provider. */
export const obdOutboundPhoneEntrySchema = z.object({
  phone: z.string().min(1),
  callid: z.string().min(1),
});

export type ObdOutboundPhoneEntry = z.infer<typeof obdOutboundPhoneEntrySchema>;

/** Normalized input for the provider client (no business logic). */
export type ObdOutboundCallInput = {
  callid: string;
  phone: string;
  correlationId: string;
  webhookUrl?: string;
};

/** Simple-voice entry inside VoiceNSMS `msisdnlist`. */
export type VoiceNsmsMsisdnListEntry = {
  phoneno: string;
  callid: string;
  voice_file: string;
  param1: string;
};

/** VoiceNSMS CreateOBDCampaignPost wire payload. */
export type ObdProviderOutboundPayload = {
  sourcetype: string;
  sendnow: string;
  campaigntype: string;
  filetype: string;
  ukey: string;
  serviceno: string;
  ivrtemplateid: string;
  retryatmpt: string;
  retryduration: string;
  msisdnlist: VoiceNsmsMsisdnListEntry[];
};

/** Convert E.164 (+91...) to 10-digit Indian MSISDN for VoiceNSMS. */
export function toVoiceNsmsMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 10) {
    return digits;
  }
  return digits;
}

export function buildObdProviderOutboundPayload(
  input: ObdOutboundCallInput,
  config: Pick<
    ObdConfig,
    | "apiKey"
    | "serviceNo"
    | "voiceFile"
    | "ivrTemplateId"
    | "retryAttempts"
    | "retryDuration"
    | "sourceType"
    | "campaignType"
    | "fileType"
    | "sendNow"
  >,
): ObdProviderOutboundPayload {
  return {
    sourcetype: config.sourceType,
    sendnow: config.sendNow,
    campaigntype: config.campaignType,
    filetype: config.fileType,
    ukey: config.apiKey,
    serviceno: config.serviceNo,
    ivrtemplateid: config.ivrTemplateId,
    retryatmpt: config.retryAttempts,
    retryduration: config.retryDuration,
    msisdnlist: [
      {
        phoneno: toVoiceNsmsMsisdn(input.phone),
        callid: input.callid,
        voice_file: config.voiceFile,
        param1: input.correlationId,
      },
    ],
  };
}
