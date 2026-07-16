import type { Request } from "express";

import { getAuthFromRequest } from "@/auth/clerk";
import type { ApiErrorBody } from "@/lib/api/tenant-context";

export async function requireAuth(req: Request) {
  const { userId } = await getAuthFromRequest(req);
  if (!userId) {
    return {
      error: { status: 401, body: { error: "Unauthorized" } } satisfies ApiErrorBody,
      userId: null,
    };
  }
  return { error: null, userId };
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
