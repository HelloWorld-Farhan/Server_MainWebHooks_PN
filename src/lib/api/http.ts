import type { Response } from "express";

import type { ApiErrorBody } from "@/lib/api/tenant-context";

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
