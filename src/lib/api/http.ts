import type { Response } from "express";

import type { ApiErrorBody } from "@/lib/api/tenant-context";
import type { AppError } from "@/server/lib/errors";

export function sendAppErrorResponse(res: Response, err: AppError) {
  return res.status(err.statusCode).json({
    error: err.message,
    code: err.code,
    statusCode: err.statusCode,
  });
}

const MISSING_ROUTE_PATTERN = /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;

export function isMissingApiRouteMessage(
  message: string | string[] | undefined,
): boolean {
  const normalized = Array.isArray(message) ? message[0] : message;
  return (
    typeof normalized === "string" && MISSING_ROUTE_PATTERN.test(normalized)
  );
}

export function sendTenantError(res: Response, error: ApiErrorBody) {
  return res.status(error.status).json(error.body);
}

export function handleTenantResult<T extends { error: ApiErrorBody | null }>(
  res: Response,
  result: T,
): result is T & { error: null } {
  if (result.error) {
    sendTenantError(res, result.error);
    return false;
  }
  return true;
}
