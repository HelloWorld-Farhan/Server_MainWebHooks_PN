import {
  ALL_USER_ROLES,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  PERMISSIONS,
  type CampaignAccessType,
  type Permission,
  type UserRole,
} from "@/lib/permissions";

export type AccessContext = {
  membershipId: string;
  userId: string;
  role: UserRole;
  permissions: string[];
  campaignAccessType: CampaignAccessType;
  campaignIds: string[];
};

export type EmployeeTarget = {
  id: string;
  userId: string;
  role: UserRole;
};

const ASSIGNABLE_BY_ROLE: Record<UserRole, UserRole[]> = {
  OWNER: ALL_USER_ROLES,
  ADMIN: ["ADMIN", "MANAGER", "AGENT", "SALES", "SUPPORT"],
  MANAGER: [],
  AGENT: [],
  SALES: [],
  SUPPORT: [],
};

export function ctxHasPermission(ctx: AccessContext, permission: Permission) {
  if (ctx.campaignAccessType === "SELECTED") {
    const companyWidePermissions: Permission[] = [
      PERMISSIONS.BILLING_READ,
      PERMISSIONS.BILLING_WRITE,
      PERMISSIONS.INTEGRATIONS_READ,
      PERMISSIONS.INTEGRATIONS_WRITE,
      PERMISSIONS.CREDITS_WRITE,
    ];
    if (companyWidePermissions.includes(permission)) {
      return false;
    }
  }
  return hasPermission(ctx.permissions, permission);
}

export function ctxHasAnyPermission(
  ctx: AccessContext,
  permissions: Permission[],
) {
  return hasAnyPermission(ctx.permissions, permissions);
}

export function ctxHasAllPermissions(
  ctx: AccessContext,
  permissions: Permission[],
) {
  return hasAllPermissions(ctx.permissions, permissions);
}

export function hasAllCampaignAccess(ctx: AccessContext): boolean {
  return ctx.role === "OWNER" || ctx.campaignAccessType === "ALL";
}

export function canAccessCampaign(ctx: AccessContext, campaignId: string): boolean {
  if (hasAllCampaignAccess(ctx)) return true;
  return ctx.campaignIds.includes(campaignId);
}

export function getAccessibleCampaignIds(ctx: AccessContext): string[] {
  if (hasAllCampaignAccess(ctx)) return [];
  return ctx.campaignIds;
}

export function getAssignableRoles(ctx: AccessContext): UserRole[] {
  return ASSIGNABLE_BY_ROLE[ctx.role] ?? [];
}

export function canAssignRole(ctx: AccessContext, role: UserRole): boolean {
  return getAssignableRoles(ctx).includes(role);
}

function isSelf(ctx: AccessContext, target: EmployeeTarget): boolean {
  return target.id === ctx.membershipId || target.userId === ctx.userId;
}

function isOwnerTarget(target: EmployeeTarget): boolean {
  return target.role === "OWNER";
}

export function canManageEmployee(
  ctx: AccessContext,
  target: EmployeeTarget,
): boolean {
  if (!ctxHasPermission(ctx, PERMISSIONS.EMPLOYEES_WRITE)) return false;
  if (isSelf(ctx, target)) return false;
  if (isOwnerTarget(target) && ctx.role !== "OWNER") return false;
  return true;
}

export function canInviteEmployee(
  ctx: AccessContext,
  roleToAssign: UserRole,
  target?: EmployeeTarget,
): boolean {
  if (!ctxHasPermission(ctx, PERMISSIONS.EMPLOYEES_INVITE)) return false;
  if (target && isSelf(ctx, target)) return false;
  if (roleToAssign === "OWNER" && ctx.role !== "OWNER") return false;
  if (target && isOwnerTarget(target) && ctx.role !== "OWNER") return false;
  return canAssignRole(ctx, roleToAssign);
}

export function canResendInvitation(
  ctx: AccessContext,
  target: EmployeeTarget,
): boolean {
  if (!ctxHasPermission(ctx, PERMISSIONS.EMPLOYEES_INVITE)) return false;
  if (isSelf(ctx, target)) return false;
  if (isOwnerTarget(target) && ctx.role !== "OWNER") return false;
  return true;
}

export function canCancelInvitation(
  ctx: AccessContext,
  target: EmployeeTarget,
): boolean {
  return canResendInvitation(ctx, target);
}

export function canDeactivateEmployee(
  ctx: AccessContext,
  target: EmployeeTarget,
): boolean {
  return canManageEmployee(ctx, target);
}

export function canDeleteEmployee(
  ctx: AccessContext,
  target: EmployeeTarget,
): boolean {
  return canManageEmployee(ctx, target);
}

export function canViewEmployee(
  ctx: AccessContext,
  _target?: EmployeeTarget,
): boolean {
  return ctxHasPermission(ctx, PERMISSIONS.EMPLOYEES_READ);
}
