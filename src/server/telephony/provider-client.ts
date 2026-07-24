import {
  buildObdProviderOutboundPayload,
  type ObdOutboundCallInput,
} from "./dto/outbound-request.dto";
import {
  extractProviderCallId,
  extractProviderErrorMessage,
  extractProviderResponseWarning,
  type ObdProviderOutboundResult,
} from "./dto/outbound-response.dto";
import type { ProviderErrorDetails } from "./dto/provider-error.dto";
import {
  assertObdDispatchConfig,
  getObdConfig,
  type ObdConfig,
} from "./obd-config";
import { isRetryableProviderError } from "./retry-policy";
import {
  logObdError,
  logObdProviderRequest,
  logObdProviderResponse,
  logObdRetry,
} from "./telephony-logger";

export type ObdProviderClientDeps = {
  fetchFn?: typeof fetch;
  config?: ObdConfig;
};

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export class ObdProviderClient {
  private readonly fetchFn: typeof fetch;
  private readonly config: ObdConfig;

  constructor(deps: ObdProviderClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.config = deps.config ?? getObdConfig();
  }

  async sendOutboundCall(
    input: ObdOutboundCallInput,
    configOverride?: Partial<ObdConfig>,
  ): Promise<ObdProviderOutboundResult> {
    const config = { ...this.config, ...configOverride };
    assertObdDispatchConfig(config);

    const payload = buildObdProviderOutboundPayload(input, config);
    const url = config.baseUrl;
    const requestHeaders = {
      "Content-Type": "application/json",
      "X-Correlation-Id": input.correlationId,
    };

    logObdProviderRequest({
      correlationId: input.correlationId,
      url,
      method: "POST",
      headers: requestHeaders,
      payload,
    });

    let lastError: ProviderErrorDetails | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      const result = await this.executeRequest(
        url,
        payload,
        input.correlationId,
        config.timeoutMs,
        requestHeaders,
      );
      if (result.ok) {
        return result;
      }

      lastError = result.error;
      const canRetry =
        attempt < config.maxRetries &&
        isRetryableProviderError(result.error);
      if (!canRetry) {
        break;
      }

      logObdRetry({
        correlationId: input.correlationId,
        attempt: attempt + 1,
        httpStatus: result.error.httpStatus,
      });
    }

    logObdError({
      correlationId: input.correlationId,
      message: lastError?.message ?? "Unknown OBD provider error",
      httpStatus: lastError?.httpStatus,
      responseBody: lastError?.responseBody,
    });

    return {
      ok: false,
      error: lastError ?? { message: "Unknown OBD provider error" },
    };
  }

  private async executeRequest(
    url: string,
    payload: ReturnType<typeof buildObdProviderOutboundPayload>,
    correlationId: string,
    timeoutMs: number,
    requestHeaders: Record<string, string>,
  ): Promise<ObdProviderOutboundResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      timeoutMs,
    );

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseBody = await parseResponseBody(response);
      const responseHeaders = headersToRecord(response.headers);

      logObdProviderResponse({
        correlationId,
        httpStatus: response.status,
        responseHeaders,
        responseBody,
        providerCallId: extractProviderCallId(responseBody),
        warning: extractProviderResponseWarning(responseBody) ?? undefined,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            message: `OBD provider returned HTTP ${response.status}`,
            httpStatus: response.status,
            responseBody,
          },
        };
      }

      const providerError = extractProviderErrorMessage(responseBody);
      if (providerError) {
        logObdError({
          correlationId,
          message: providerError,
          httpStatus: response.status,
          responseBody,
        });
        return {
          ok: false,
          error: {
            message: providerError,
            httpStatus: response.status,
            responseBody,
          },
        };
      }

      const warning = extractProviderResponseWarning(responseBody);
      if (warning) {
        logObdError({
          correlationId,
          message: warning,
          httpStatus: response.status,
          responseBody,
        });
      }

      return {
        ok: true,
        providerCallId: extractProviderCallId(responseBody),
        raw: responseBody,
        warning: warning ?? undefined,
      };
    } catch (error) {
      const isAbort =
        error instanceof Error && error.name === "AbortError";
      const message = isAbort
        ? `OBD provider request timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "OBD provider network error";

      logObdError({
        correlationId,
        message,
      });

      return {
        ok: false,
        error: {
          message,
          isNetworkError: !isAbort,
          isTimeout: isAbort,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const obdProviderClient = new ObdProviderClient();
