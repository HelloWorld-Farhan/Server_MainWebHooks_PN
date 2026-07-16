import type { UserRole } from "@prisma/client";

import {
  type Permission,
  PERMISSIONS,
} from "@/lib/permissions";
import {
  canAccessBranch as policyCanAccessBranch,
  canAssignRole as policyCanAssignRole,
  canCancelInvitation as policyCanCancelInvitation,
  canDeactivateEmployee as policyCanDeactivateEmployee,
  canDeleteEmployee as policyCanDeleteEmployee,
  canInviteEmployee as policyCanInviteEmployee,
  canManageEmployee as policyCanManageEmployee,
  canResendInvitation as policyCanResendInvitation,
  canViewEmployee as policyCanViewEmployee,
  ctxHasAllPermissions,
  ctxHasAnyPermission,
  ctxHasPermission,
  getAccessibleBranchIds as policyGetAccessibleBranchIds,
  getAssignableRoles as policyGetAssignableRoles,
  hasAllBranchAccess as policyHasAllBranchAccess,
  type AccessContext,
  type EmployeeTarget,
} from "@/lib/permissions-policy";
import { ForbiddenError } from "@/server/lib/errors";
import { branchAccessService } from "@/server/services/branch-access.service";
import type { TenantContext } from "@/server/types/context";

export type { AccessContext, EmployeeTarget };

export function toAccessContext(ctx: TenantContext): AccessContext {
  return {
    membershipId: ctx.membershipId,
    userId: ctx.userId,
    role: ctx.role as AccessContext["role"],
    permissions: ctx.permissions,
    branchAccessType: ctx.branchAccess.type,
    branchIds: ctx.branchAccess.branchIds,
  };
}

export function hasPermission(ctx: TenantContext, permission: Permission) {
  return ctxHasPermission(toAccessContext(ctx), permission);
}

export function hasAnyPermission(
  ctx: TenantContext,
  permissions: Permission[],
) {
  return ctxHasAnyPermission(toAccessContext(ctx), permissions);
}

export function hasAllPermissions(
  ctx: TenantContext,
  permissions: Permission[],
) {
  return ctxHasAllPermissions(toAccessContext(ctx), permissions);
}

export function canAccessBranch(ctx: TenantContext, branchId: string) {
  if (branchAccessService.hasAllBranchAccess(ctx)) return true;
  return policyCanAccessBranch(toAccessContext(ctx), branchId);
}

export function getAccessibleBranchIds(ctx: TenantContext) {
  return policyGetAccessibleBranchIds(toAccessContext(ctx));
}

export function hasAllBranchAccess(ctx: TenantContext) {
  return policyHasAllBranchAccess(toAccessContext(ctx));
}

export function getAssignableRoles(ctx: TenantContext): UserRole[] {
  return policyGetAssignableRoles(toAccessContext(ctx)) as UserRole[];
}

export function canAssignRole(ctx: TenantContext, role: UserRole) {
  return policyCanAssignRole(
    toAccessContext(ctx),
    role as AccessContext["role"],
  );
}

export function canManageUser(ctx: TenantContext, target: EmployeeTarget) {
  return policyCanManageEmployee(toAccessContext(ctx), target);
}

export function canManageEmployee(ctx: TenantContext, target: EmployeeTarget) {
  return policyCanManageEmployee(toAccessContext(ctx), target);
}

export function canInviteEmployee(
  ctx: TenantContext,
  roleToAssign: UserRole,
  target?: EmployeeTarget,
) {
  return policyCanInviteEmployee(
    toAccessContext(ctx),
    roleToAssign as AccessContext["role"],
    target,
  );
}

export function canResendInvitation(
  ctx: TenantContext,
  target: EmployeeTarget,
) {
  return policyCanResendInvitation(toAccessContext(ctx), target);
}

export function canCancelInvitation(
  ctx: TenantContext,
  target: EmployeeTarget,
) {
  return policyCanCancelInvitation(toAccessContext(ctx), target);
}

export function canDeactivateEmployee(
  ctx: TenantContext,
  target: EmployeeTarget,
) {
  return policyCanDeactivateEmployee(toAccessContext(ctx), target);
}

export function canDeleteEmployee(ctx: TenantContext, target: EmployeeTarget) {
  return policyCanDeleteEmployee(toAccessContext(ctx), target);
}

export function canViewEmployee(ctx: TenantContext, target?: EmployeeTarget) {
  return policyCanViewEmployee(toAccessContext(ctx), target);
}

export function assertCanManageEmployee(
  ctx: TenantContext,
  target: EmployeeTarget,
  action: "update" | "deactivate" | "delete" | "cancel",
) {
  const access = toAccessContext(ctx);
  const allowed =
    action === "cancel"
      ? policyCanCancelInvitation(access, target)
      : policyCanManageEmployee(access, target);

  if (!allowed) {
    if (target.id === ctx.membershipId || target.userId === ctx.userId) {
      throw new ForbiddenError(`You cannot ${action} your own account`);
    }
    if (target.role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only owners can manage owner accounts");
    }
    throw new ForbiddenError(`Missing permission for action: ${action}`);
  }
}

export function assertCanAssignRole(ctx: TenantContext, role: UserRole) {
  if (!canAssignRole(ctx, role)) {
    if (role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only owners can assign the owner role");
    }
    throw new ForbiddenError("You cannot assign this role");
  }
}

export function assertCanInviteRole(ctx: TenantContext, role: UserRole) {
  if (!canInviteEmployee(ctx, role)) {
    if (role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only owners can invite other owners");
    }
    throw new ForbiddenError("You cannot invite with this role");
  }
}

export { PERMISSIONS };
