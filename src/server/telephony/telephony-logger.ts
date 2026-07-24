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

export function logObdProviderRequest(fields: {
  correlationId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  payload: unknown;
}): void {
  console.info("[obd:provider-request]", {
    correlationId: fields.correlationId,
    url: fields.url,
    method: fields.method,
    headers: fields.headers,
    payload: fields.payload,
  });
}

export function logObdProviderResponse(fields: {
  correlationId: string;
  httpStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  providerCallId?: string | null;
  warning?: string;
}): void {
  console.info("[obd:provider-response]", {
    correlationId: fields.correlationId,
    httpStatus: fields.httpStatus,
    responseHeaders: fields.responseHeaders,
    responseBody: fields.responseBody,
    providerCallId: fields.providerCallId ?? null,
    ...(fields.warning ? { warning: fields.warning } : {}),
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
  responseBody?: unknown;
}): void {
  console.warn("[obd:error]", {
    correlationId: fields.correlationId,
    message: fields.message,
    httpStatus: fields.httpStatus,
    ...(fields.responseBody !== undefined
      ? { responseBody: fields.responseBody }
      : {}),
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
