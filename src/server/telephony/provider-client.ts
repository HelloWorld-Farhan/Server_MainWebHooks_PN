import {
  buildObdProviderOutboundPayload,
  type ObdOutboundCallInput,
} from "./dto/outbound-request.dto";
import {
  extractProviderCallId,
  extractProviderErrorMessage,
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
  private readonly configOverride?: ObdConfig;
  private cachedToken: string | null = null;

  constructor(deps: ObdProviderClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.configOverride = deps.config;
  }

  private async authenticateAndGetToken(config: ObdConfig): Promise<string> {
    if (this.cachedToken) {
      return this.cachedToken;
    }
    
    try {
      const authUrl = "https://backend.pbx.bonvoice.com/usermanagement/external-auth/";
      const response = await this.fetchFn(authUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: config.username,
          password: config.password,
        }),
      });

      if (!response.ok) {
        throw new Error(`Auth failed with HTTP ${response.status}`);
      }

      const body = await response.json() as { data?: { token?: string } };
      if (body?.data?.token) {
        this.cachedToken = body.data.token;
        return this.cachedToken;
      }
      
      throw new Error("Token not found in auth response");
    } catch (err) {
      logObdError({
        correlationId: "AUTH",
        message: err instanceof Error ? err.message : "Authentication error",
      });
      throw err;
    }
  }

  async sendOutboundCall(
    input: ObdOutboundCallInput,
    configOverride?: Partial<ObdConfig>,
  ): Promise<ObdProviderOutboundResult> {
    // Always re-read env-backed config so Render env updates apply without stale module state.
    const config = {
      ...(this.configOverride ?? getObdConfig()),
      ...configOverride,
    };
    assertObdDispatchConfig(config);

    const payload = buildObdProviderOutboundPayload(input, config);
    const url = config.baseUrl;

    let lastError: ProviderErrorDetails | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      let token: string;
      try {
        token = await this.authenticateAndGetToken(config);
      } catch (err) {
        return {
          ok: false,
          error: { message: "Failed to authenticate with Bonvoice provider", isNetworkError: true }
        };
      }
      
      const requestHeaders = {
        "Content-Type": "application/json",
        "X-Correlation-Id": input.correlationId,
        Authorization: `Token ${token}`,
      };

      if (attempt === 0) {
        logObdProviderRequest({
          correlationId: input.correlationId,
          url,
          method: "POST",
          headers: requestHeaders,
          payload,
        });
      }

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
      
      if (result.error.httpStatus === 401 || result.error.httpStatus === 403) {
        this.cachedToken = null; // Invalidate token and retry
      }

      const canRetry =
        attempt < config.maxRetries &&
        (isRetryableProviderError(result.error) || result.error.httpStatus === 401 || result.error.httpStatus === 403);
        
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

      return {
        ok: true,
        providerCallId: extractProviderCallId(responseBody),
        raw: responseBody,
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
