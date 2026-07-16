import type { Request } from "express";

import type { ApiErrorBody } from "@/lib/api/tenant-context";

const COMPANY_ID_HEADER = "x-company-id";
const API_KEY_HEADER = "x-agent-server-key";

export function validateAgentServerRequest(req: Request): {
  companyId: string;
  error?: ApiErrorBody;
} {
  const expectedKey = process.env.AGENT_SERVER_API_KEY;
  if (!expectedKey) {
    return {
      companyId: "",
      error: {
        status: 503,
        body: { error: "Agent server API key is not configured" },
      },
    };
  }

  const providedKey = req.headers[API_KEY_HEADER] as string | undefined;
  if (!providedKey || providedKey !== expectedKey) {
    return {
      companyId: "",
      error: { status: 401, body: { error: "Unauthorized" } },
    };
  }

  const companyId = (req.headers[COMPANY_ID_HEADER] as string | undefined)?.trim();
  if (!companyId) {
    return {
      companyId: "",
      error: {
        status: 400,
        body: { error: "X-Company-Id header is required" },
      },
    };
  }

  return { companyId };
}
