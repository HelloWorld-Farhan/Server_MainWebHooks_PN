import type { TenantContext } from "@/server/types/context";

export type ApiKeyAuditAction =
  | "CREATED"
  | "UPDATED"
  | "ENABLED"
  | "DISABLED"
  | "REGENERATED"
  | "ROTATED"
  | "DELETED"
  | "SCOPES_UPDATED"
  | "BRANCH_ACCESS_UPDATED"
  | "EXPIRATION_UPDATED";

type AuditDeps = {
  create: (data: {
    companyId: string;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    changes: Record<string, unknown>;
  }) => Promise<unknown>;
};

/**
 * Thin audit helper so a dedicated audit service can replace this later.
 */
export async function recordApiKeyAudit(
  deps: AuditDeps,
  ctx: TenantContext,
  apiKeyId: string,
  action: ApiKeyAuditAction,
  changes: Record<string, unknown> = {},
): Promise<void> {
  await deps.create({
    companyId: ctx.companyId,
    userId: ctx.authType === "user" ? ctx.userId : ctx.userId || null,
    action,
    entityType: "ApiKey",
    entityId: apiKeyId,
    changes: {
      ...changes,
      authType: ctx.authType,
      apiKeyId: ctx.apiKeyId ?? null,
    },
  });
}
