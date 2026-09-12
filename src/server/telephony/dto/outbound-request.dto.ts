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

/** Bonvoice autoCallBridging payload */
export type ObdProviderOutboundPayload = {
  autocallType: "5";
  destination: string;
  legACallerID: string;
  eventID: string;
  voicebotProvider: "BONVOICE";
  voicebotURL: string;
};

/** Convert E.164 (+91...) to 10-digit Indian MSISDN */
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

/** Build Bonvoice autoCallBridging payload */
export function buildObdProviderOutboundPayload(
  input: ObdOutboundCallInput,
  config: Pick<
    ObdConfig,
    "serviceNo" | "voicebotUrl"
  >,
): ObdProviderOutboundPayload {
  const destination = toVoiceNsmsMsisdn(input.phone);
  
  return {
    autocallType: "5",
    destination,
    legACallerID: config.serviceNo,
    eventID: input.callid,
    voicebotProvider: "BONVOICE",
    voicebotURL: config.voicebotUrl ?? "",
  };
}
