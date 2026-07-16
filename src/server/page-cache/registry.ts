import type { PageCacheKey } from "@/server/cache/keys";
import {
  loadAgentDetailPage,
  loadAgentLibraryPage,
  loadAgentsPage,
  loadAgentTemplatePage,
  loadBillingPage,
  loadCallDetailPage,
  loadCallLogsPage,
  loadHomePage,
  loadLeadReactivationPage,
  loadPhoneDetailPage,
  loadPhoneContactsPage,
  loadSettingsPage,
  loadSetupPage,
  type PageLoader,
} from "@/server/page-cache/loaders";

const PAGE_LOADERS: Record<PageCacheKey, PageLoader> = {
  home: loadHomePage,
  billing: loadBillingPage,
  "call-logs": loadCallLogsPage,
  "call-detail": loadCallDetailPage,
  agents: loadAgentsPage,
  "agent-detail": loadAgentDetailPage,
  "agent-library": loadAgentLibraryPage,
  "agent-template": loadAgentTemplatePage,
  "lead-reactivation": loadLeadReactivationPage,
  setup: loadSetupPage,
  settings: loadSettingsPage,
  "phone-detail": loadPhoneDetailPage,
  "phone-contacts": loadPhoneContactsPage,
};

export function getPageLoader(pageKey: string): PageLoader | null {
  return PAGE_LOADERS[pageKey as PageCacheKey] ?? null;
}

export function isValidPageCacheKey(pageKey: string): pageKey is PageCacheKey {
  return pageKey in PAGE_LOADERS;
}
