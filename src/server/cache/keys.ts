import { createHash } from "node:crypto";

export const CACHE_TTL = {
  CREDITS: 5 * 60,
  TOP_CALL_LOGS: 2 * 60,
  ANALYTICS: 5 * 60,
  PERMISSIONS: 30 * 60,
  AGENT_STATUS: 60,
  PAGE_CACHE: 30,
  CLERK_MEMBERSHIPS: 45,
  CLERK_ORG_MEMBERSHIPS: 45,
  RESOLVED_COMPANY: 30,
} as const;

export const PAGE_CACHE_STALE_MS = 10_000;
export const CLERK_MEMBERSHIPS_STALE_MS = 35_000;

export type PageCacheKey =
  | "home"
  | "billing"
  | "call-logs"
  | "call-detail"
  | "agents"
  | "agent-detail"
  | "agent-library"
  | "agent-template"
  | "lead-reactivation"
  | "setup"
  | "settings"
  | "phone-detail"
  | "phone-contacts";

export type PageCacheParams = {
  id?: string;
  slug?: string;
  after?: string;
  filter?: Record<string, unknown>;
};

function hashValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? {}))
    .digest("hex")
    .slice(0, 16);
}

export type ResolvedCompanyCache = {
  companyId: string;
  membershipId: string;
  role: string;
  cachedAt: number;
};

export const cacheKeys = {
  clerkMemberships: (clerkUserId: string) =>
    `clerk:memberships:${clerkUserId}`,
  clerkOrgMemberships: (orgId: string) => `clerk:org-memberships:${orgId}`,
  resolvedCompany: (clerkUserId: string) => `company:${clerkUserId}`,
  companyCredits: (companyId: string) => `company:${companyId}:credits`,
  companyTopCallLogs: (companyId: string) =>
    `company:${companyId}:top-call-logs`,
  companyAnalytics: (companyId: string) => `company:${companyId}:analytics`,
  userPermissions: (userId: string) => `user:${userId}:permissions`,
  companyAgentStatus: (companyId: string) =>
    `company:${companyId}:agent-status`,
  page: (companyId: string, pageKey: PageCacheKey, params?: PageCacheParams) => {
    const base = `page:${companyId}:${pageKey}`;
    switch (pageKey) {
      case "call-logs":
        return `${base}:${hashValue({ after: params?.after, filter: params?.filter })}`;
      case "call-detail":
      case "agent-detail":
        return `${base}:${params?.id ?? "missing"}`;
      case "agent-template":
        return `${base}:${params?.slug ?? "missing"}`;
      case "lead-reactivation":
        return `${base}:${hashValue(params?.filter)}`;
      case "phone-detail":
        return `${base}:${params?.id ?? "missing"}:${hashValue({ after: params?.after })}`;
      case "billing":
        return `${base}:${hashValue({ after: params?.after })}`;
      case "home":
        return `${base}:${hashValue(params?.filter)}`;
      default:
        return base;
    }
  },
  pagePrefix: (companyId: string, pageKey: PageCacheKey) =>
    `page:${companyId}:${pageKey}`,
};
