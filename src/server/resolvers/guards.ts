import type { Permission } from "@/server/types/permissions";
import { hasPermission } from "@/server/types/permissions";
import type { TenantContext } from "@/server/types/context";
import { ForbiddenError } from "@/server/lib/errors";

export function requirePermission(
  ctx: TenantContext,
  permission: Permission,
): void {
  if (!hasPermission(ctx.permissions, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}
