import {
  AGENT_DETAIL_PAGE_QUERY,
  AGENT_LIBRARY_BY_SLUG_QUERY,
  AGENT_LIBRARY_LIST_QUERY,
  AGENTS_LIST_QUERY,
  BILLING_PAGE_QUERY,
  CALL_DETAIL_QUERY,
  CALL_LOGS_PAGE_QUERY,
  HOME_PAGE_QUERY,
  LEADS_REACTIVATION_QUERY,
  PHONE_NUMBER_DETAIL_QUERY,
  SETTINGS_PAGE_QUERY,
  SETUP_PAGE_QUERY,
  UPLOADED_CONTACTS_LIST_QUERY,
} from "@/lib/graphql/queries";
import type { PageCacheParams } from "@/server/cache/keys";
import { executeGraphQLFromRequest } from "@/server/page-cache/execute-graphql";

export type PageLoader = (
  request: Request,
  params: PageCacheParams,
) => Promise<unknown>;

export async function loadHomePage(
  request: Request,
  params: PageCacheParams,
) {
  const filter = params.filter as
    | { dateFrom?: string; dateTo?: string }
    | undefined;

  return executeGraphQLFromRequest(request, HOME_PAGE_QUERY, {
    dateFrom: filter?.dateFrom,
    dateTo: filter?.dateTo,
  });
}

export async function loadBillingPage(
  request: Request,
  params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, BILLING_PAGE_QUERY, {
    after: params.after,
  });
}

export async function loadCallLogsPage(
  request: Request,
  params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, CALL_LOGS_PAGE_QUERY, {
    after: params.after,
    filter: params.filter,
  });
}

export async function loadCallDetailPage(
  request: Request,
  params: PageCacheParams,
) {
  if (!params.id) {
    throw new Error("id is required for call-detail page cache");
  }
  return executeGraphQLFromRequest(request, CALL_DETAIL_QUERY, {
    id: params.id,
  });
}

export async function loadAgentsPage(
  request: Request,
  _params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, AGENTS_LIST_QUERY);
}

export async function loadAgentDetailPage(
  request: Request,
  params: PageCacheParams,
) {
  if (!params.id) {
    throw new Error("id is required for agent-detail page cache");
  }
  return executeGraphQLFromRequest(request, AGENT_DETAIL_PAGE_QUERY, {
    id: params.id,
  });
}

export async function loadAgentLibraryPage(
  request: Request,
  _params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, AGENT_LIBRARY_LIST_QUERY);
}

export async function loadAgentTemplatePage(
  request: Request,
  params: PageCacheParams,
) {
  if (!params.slug) {
    throw new Error("slug is required for agent-template page cache");
  }
  return executeGraphQLFromRequest(request, AGENT_LIBRARY_BY_SLUG_QUERY, {
    slug: params.slug,
  });
}

export async function loadLeadReactivationPage(
  request: Request,
  params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, LEADS_REACTIVATION_QUERY, {
    after: params.after,
    filter: params.filter,
  });
}

export async function loadSetupPage(
  request: Request,
  _params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, SETUP_PAGE_QUERY);
}

export async function loadSettingsPage(
  request: Request,
  _params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, SETTINGS_PAGE_QUERY);
}

export async function loadPhoneDetailPage(
  request: Request,
  params: PageCacheParams,
) {
  if (!params.id) {
    throw new Error("id is required for phone-detail page cache");
  }
  return executeGraphQLFromRequest(request, PHONE_NUMBER_DETAIL_QUERY, {
    id: params.id,
    after: params.after,
  });
}

export async function loadPhoneContactsPage(
  request: Request,
  _params: PageCacheParams,
) {
  return executeGraphQLFromRequest(request, UPLOADED_CONTACTS_LIST_QUERY);
}
