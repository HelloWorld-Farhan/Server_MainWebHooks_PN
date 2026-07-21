export const PERMISSIONS = {
  BILLING_READ: "billing:read",
  BILLING_WRITE: "billing:write",
  CREDITS_READ: "credits:read",
  CREDITS_WRITE: "credits:write",
  CALL_LOGS_READ: "call_logs:read",
  CALL_LOGS_WRITE: "call_logs:write",
  AGENTS_READ: "agents:read",
  AGENTS_WRITE: "agents:write",
  LEADS_READ: "leads:read",
  LEADS_WRITE: "leads:write",
  ANALYTICS_READ: "analytics:read",
  ANALYTICS_WRITE: "analytics:write",
  INTEGRATIONS_READ: "integrations:read",
  INTEGRATIONS_WRITE: "integrations:write",
  NOTIFICATIONS_READ: "notifications:read",
  EVENTS_READ: "events:read",
  SCHEDULER_READ: "scheduler:read",
  SCHEDULER_WRITE: "scheduler:write",
  SETTINGS_WRITE: "settings:write",
  CAMPAIGNS_READ: "campaigns:read",
  CAMPAIGNS_WRITE: "campaigns:write",
  CAMPAIGNS_BULK: "campaigns:bulk",
  DOCUMENTS_READ: "documents:read",
  DOCUMENTS_WRITE: "documents:write",
  EMPLOYEES_READ: "employees:read",
  EMPLOYEES_WRITE: "employees:write",
  EMPLOYEES_INVITE: "employees:invite",
  API_KEYS_READ: "api_keys:read",
  API_KEYS_WRITE: "api_keys:write",
  PHONE_NUMBERS_READ: "phone_numbers:read",
  PHONE_NUMBERS_WRITE: "phone_numbers:write",
  WEBHOOKS_READ: "webhooks:read",
  WEBHOOKS_WRITE: "webhooks:write",
  ORGANIZATION_READ: "organization:read",
  ORGANIZATION_WRITE: "organization:write",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Scopes that may be assigned to an API key. */
export const API_KEY_SCOPE_CATALOG: Permission[] = [
  PERMISSIONS.AGENTS_READ,
  PERMISSIONS.AGENTS_WRITE,
  PERMISSIONS.CALL_LOGS_READ,
  PERMISSIONS.CALL_LOGS_WRITE,
  PERMISSIONS.ANALYTICS_READ,
  PERMISSIONS.LEADS_READ,
  PERMISSIONS.LEADS_WRITE,
  PERMISSIONS.CAMPAIGNS_READ,
  PERMISSIONS.CAMPAIGNS_WRITE,
  PERMISSIONS.DOCUMENTS_READ,
  PERMISSIONS.DOCUMENTS_WRITE,
  PERMISSIONS.PHONE_NUMBERS_READ,
  PERMISSIONS.PHONE_NUMBERS_WRITE,
  PERMISSIONS.INTEGRATIONS_READ,
  PERMISSIONS.INTEGRATIONS_WRITE,
  PERMISSIONS.BILLING_READ,
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.ORGANIZATION_WRITE,
  PERMISSIONS.EMPLOYEES_READ,
  PERMISSIONS.EMPLOYEES_WRITE,
  PERMISSIONS.WEBHOOKS_READ,
  PERMISSIONS.WEBHOOKS_WRITE,
  PERMISSIONS.API_KEYS_READ,
  PERMISSIONS.API_KEYS_WRITE,
];

export type UserRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "AGENT"
  | "SALES"
  | "SUPPORT";

export type CampaignAccessType = "ALL" | "SELECTED";

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
  SALES: "Sales",
  SUPPORT: "Support",
};

export const ALL_USER_ROLES: UserRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "AGENT",
  "SALES",
  "SUPPORT",
];

export function mergePermissions(
  rolePermissions: Permission[],
  customPermissions: string[],
): string[] {
  return [...new Set([...rolePermissions, ...customPermissions])];
}

export function hasPermission(
  permissions: string[],
  required: Permission,
): boolean {
  return permissions.includes(required);
}

export function hasAnyPermission(
  permissions: string[],
  required: Permission[],
): boolean {
  return required.some((p) => permissions.includes(p));
}

export function hasAllPermissions(
  permissions: string[],
  required: Permission[],
): boolean {
  return required.every((p) => permissions.includes(p));
}

export function getPermissionLabels(): Record<Permission, string> {
  return {
    [PERMISSIONS.BILLING_READ]: "View Billing",
    [PERMISSIONS.BILLING_WRITE]: "Manage Billing",
    [PERMISSIONS.CREDITS_READ]: "View Credits",
    [PERMISSIONS.CREDITS_WRITE]: "Manage Credits",
    [PERMISSIONS.CALL_LOGS_READ]: "View Calls",
    [PERMISSIONS.CALL_LOGS_WRITE]: "Manage Calls",
    [PERMISSIONS.AGENTS_READ]: "View AI Agents",
    [PERMISSIONS.AGENTS_WRITE]: "Manage AI Agents",
    [PERMISSIONS.LEADS_READ]: "View Contacts",
    [PERMISSIONS.LEADS_WRITE]: "Manage Contacts",
    [PERMISSIONS.ANALYTICS_READ]: "View Analytics",
    [PERMISSIONS.ANALYTICS_WRITE]: "Manage Analytics",
    [PERMISSIONS.INTEGRATIONS_READ]: "View Integrations",
    [PERMISSIONS.INTEGRATIONS_WRITE]: "Manage Integrations",
    [PERMISSIONS.NOTIFICATIONS_READ]: "View Notifications",
    [PERMISSIONS.EVENTS_READ]: "View Events",
    [PERMISSIONS.SCHEDULER_READ]: "View Scheduler",
    [PERMISSIONS.SCHEDULER_WRITE]: "Manage Scheduler",
    [PERMISSIONS.SETTINGS_WRITE]: "Manage Settings",
    [PERMISSIONS.CAMPAIGNS_READ]: "View Campaigns",
    [PERMISSIONS.CAMPAIGNS_WRITE]: "Manage Campaigns",
    [PERMISSIONS.CAMPAIGNS_BULK]: "Bulk Branch Actions",
    [PERMISSIONS.DOCUMENTS_READ]: "View Documents",
    [PERMISSIONS.DOCUMENTS_WRITE]: "Manage Documents",
    [PERMISSIONS.EMPLOYEES_READ]: "View Employees",
    [PERMISSIONS.EMPLOYEES_WRITE]: "Manage Employees",
    [PERMISSIONS.EMPLOYEES_INVITE]: "Invite Employees",
    [PERMISSIONS.API_KEYS_READ]: "View API Keys",
    [PERMISSIONS.API_KEYS_WRITE]: "Manage API Keys",
    [PERMISSIONS.PHONE_NUMBERS_READ]: "View Phone Numbers",
    [PERMISSIONS.PHONE_NUMBERS_WRITE]: "Manage Phone Numbers",
    [PERMISSIONS.WEBHOOKS_READ]: "View Webhooks",
    [PERMISSIONS.WEBHOOKS_WRITE]: "Manage Webhooks",
    [PERMISSIONS.ORGANIZATION_READ]: "View Organization",
    [PERMISSIONS.ORGANIZATION_WRITE]: "Manage Organization",
  };
}

export function getApiKeyScopeLabels(): Record<string, string> {
  const labels = getPermissionLabels();
  return Object.fromEntries(
    API_KEY_SCOPE_CATALOG.map((scope) => [scope, labels[scope]]),
  );
}

export function isApiKeyScope(scope: string): scope is Permission {
  return (API_KEY_SCOPE_CATALOG as string[]).includes(scope);
}
