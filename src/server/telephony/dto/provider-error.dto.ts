export type ProviderErrorDetails = {
  message: string;
  httpStatus?: number;
  responseBody?: unknown;
  isNetworkError?: boolean;
  isTimeout?: boolean;
};

export function toProviderErrorJson(
  error: ProviderErrorDetails,
): Record<string, unknown> {
  return {
    message: error.message,
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    ...(error.responseBody !== undefined
      ? { responseBody: error.responseBody }
      : {}),
    ...(error.isNetworkError ? { isNetworkError: true } : {}),
    ...(error.isTimeout ? { isTimeout: true } : {}),
  };
}
