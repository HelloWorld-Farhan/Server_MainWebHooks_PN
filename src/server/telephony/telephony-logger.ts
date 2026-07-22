function maskPhone(phone: string): string {
  if (phone.length <= 4) {
    return "****";
  }
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

export function logObdOutbound(fields: {
  correlationId: string;
  callLogPublicId: string;
  campaignPublicId?: string;
  companyId: string;
  phone: string;
}): void {
  console.info("[obd:outbound]", {
    correlationId: fields.correlationId,
    callLogPublicId: fields.callLogPublicId,
    campaignPublicId: fields.campaignPublicId,
    companyId: fields.companyId,
    phone: maskPhone(fields.phone),
  });
}

export function logObdProviderResponse(fields: {
  correlationId: string;
  httpStatus: number;
  providerCallId?: string | null;
}): void {
  console.info("[obd:provider-response]", {
    correlationId: fields.correlationId,
    httpStatus: fields.httpStatus,
    providerCallId: fields.providerCallId ?? null,
  });
}

export function logObdWebhook(fields: {
  correlationId?: string;
  callLogPublicId: string;
  providerStatus: string;
  durationSeconds: number;
  durationMs: number;
}): void {
  console.info("[obd:webhook]", {
    correlationId: fields.correlationId,
    callLogPublicId: fields.callLogPublicId,
    providerStatus: fields.providerStatus,
    durationSeconds: fields.durationSeconds,
    durationMs: fields.durationMs,
  });
}

export function logObdRetry(fields: {
  correlationId: string;
  attempt: number;
  httpStatus?: number;
}): void {
  console.warn("[obd:retry]", {
    correlationId: fields.correlationId,
    attempt: fields.attempt,
    httpStatus: fields.httpStatus,
  });
}

export function logObdError(fields: {
  correlationId: string;
  message: string;
  httpStatus?: number;
}): void {
  console.warn("[obd:error]", {
    correlationId: fields.correlationId,
    message: fields.message,
    httpStatus: fields.httpStatus,
  });
}

export function logObdWebhookDuplicate(fields: {
  correlationId?: string;
  callLogPublicId: string;
  providerEventId: string;
  durationMs: number;
}): void {
  console.info("[obd:webhook:duplicate]", {
    correlationId: fields.correlationId,
    callLogPublicId: fields.callLogPublicId,
    providerEventId: fields.providerEventId,
    durationMs: fields.durationMs,
  });
}
