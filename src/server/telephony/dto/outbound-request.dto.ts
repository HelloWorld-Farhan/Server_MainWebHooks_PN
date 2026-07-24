import { z } from "zod";

import { displayContactFieldValue } from "@/lib/contact-phone-fields";
import type { ObdConfig } from "@/server/telephony/obd-config";

/** Single phone entry sent to the OBD provider. */
export const obdOutboundPhoneEntrySchema = z.object({
  phone: z.string().min(1),
  callid: z.string().min(1),
});

export type ObdOutboundPhoneEntry = z.infer<typeof obdOutboundPhoneEntrySchema>;

/** Contact custom fields mapped into VoiceNSMS `msisdnlist`. */
export type ObdOutboundContactFields = {
  userName?: string | null;
  recordingUrl?: string | null;
  transcripts?: string | null;
  summary?: string | null;
};

/** Normalized input for the provider client (no business logic). */
export type ObdOutboundCallInput = {
  callid: string;
  phone: string;
  correlationId: string;
  webhookUrl?: string;
  contactFields?: ObdOutboundContactFields;
};

/** VoiceNSMS msisdnlist entry (callid for webhook correlation; no per-call webhookurl). */
export type VoiceNsmsMsisdnListEntry = {
  phoneno: string;
  callid: string;
  user_name: string;
  "Recording URL": string;
  Summary: string;
  " Transcripts": string;
};

/** VoiceNSMS CreateOBDCampaignPost wire payload. */
export type ObdProviderOutboundPayload = {
  sourcetype: string;
  sendnow: string;
  schddate?: string;
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

export function formatObdScheduleDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Build VoiceNSMS CreateOBDCampaignPost payload (callid included; webhookurl omitted). */
export function buildObdProviderOutboundPayload(
  input: ObdOutboundCallInput,
  config: Pick<
    ObdConfig,
    | "apiKey"
    | "serviceNo"
    | "ivrTemplateId"
    | "retryAttempts"
    | "retryDuration"
    | "sourceType"
    | "campaignType"
    | "fileType"
    | "sendNow"
  >,
): ObdProviderOutboundPayload {
  const fields = input.contactFields ?? {};
  const sendNow = config.sendNow === "1" ? "1" : "0";
  const payload: ObdProviderOutboundPayload = {
    sourcetype: config.sourceType,
    sendnow: sendNow,
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
        user_name: displayContactFieldValue(fields.userName),
        "Recording URL": displayContactFieldValue(fields.recordingUrl),
        Summary: displayContactFieldValue(fields.summary),
        " Transcripts": displayContactFieldValue(fields.transcripts),
      },
    ],
  };

  if (sendNow !== "1") {
    payload.schddate =
      process.env.OBD_SCHEDULE_DATE?.trim() || formatObdScheduleDate();
  }

  return payload;
}
