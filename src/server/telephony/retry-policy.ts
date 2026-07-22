import type { ProviderErrorDetails } from "@/server/telephony/dto/provider-error.dto";

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);

export function isRetryableHttpStatus(httpStatus: number): boolean {
  if (NON_RETRYABLE_HTTP_STATUSES.has(httpStatus)) {
    return false;
  }
  return RETRYABLE_HTTP_STATUSES.has(httpStatus);
}

export function isRetryableProviderError(error: ProviderErrorDetails): boolean {
  if (error.isNetworkError || error.isTimeout) {
    return true;
  }
  if (error.httpStatus === undefined) {
    return false;
  }
  return isRetryableHttpStatus(error.httpStatus);
}
