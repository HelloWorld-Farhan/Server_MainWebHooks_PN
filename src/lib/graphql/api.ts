import { gqlRequest } from "@/lib/graphql/client";
import {
  AGENT_DETAIL_PAGE_QUERY,
  AGENT_DETAIL_QUERY,
  AGENT_LIBRARY_BY_SLUG_QUERY,
  AGENT_LIBRARY_LIST_QUERY,
  AGENTS_LIST_QUERY,
  BILLING_PAGE_QUERY,
  CALL_DETAIL_QUERY,
  CALL_LOGS_PAGE_QUERY,
  CREATE_AGENT_MUTATION,
  CREATE_PHONE_NUMBER_MUTATION,
  CREDITS_SUMMARY_QUERY,
  HOME_PAGE_QUERY,
  LEADS_REACTIVATION_QUERY,
  IMPORT_LEADS_MUTATION,
  PHONE_NUMBER_DETAIL_QUERY,
  PHONE_NUMBERS_PAGE_QUERY,
  SETTINGS_PAGE_QUERY,
  SETUP_PAGE_QUERY,
  UPLOADED_CONTACTS_LIST_QUERY,
  CREATE_UPLOADED_CONTACT_MUTATION,
  IMPORT_UPLOADED_CONTACTS_MUTATION,
  DELETE_UPLOADED_CONTACT_MUTATION,
  BULK_DELETE_UPLOADED_CONTACTS_MUTATION,
  UPDATE_AGENT_MUTATION,
  UPDATE_PHONE_NUMBER_MUTATION,
  type BillingPageResult,
  type CallLogsPageResult,
  type CreditsSummaryResult,
  type HomePageResult,
  type LeadImportResult,
  type LeadsReactivationResult,
  type SettingsPageResult,
  type SetupPageResult,
  type UploadedContactsListResult,
  type UploadedContactImportResult,
  type ImportedContactInput,
  type AgentLibraryBySlugResult,
  type AgentLibraryListResult,
  BRANCHES_PAGE_QUERY,
  BRANCH_DETAIL_QUERY,
  BRANCH_CONTACTS_QUERY,
  BRANCH_CALL_LOGS_QUERY,
  BRANCH_DOCUMENTS_QUERY,
  BRANCH_AGENTS_QUERY,
  CREATE_BRANCH_MUTATION,
  UPDATE_BRANCH_MUTATION,
  UPDATE_BRANCH_AI_MUTATION,
  BULK_UPDATE_BRANCHES_MUTATION,
  ARCHIVE_BRANCH_MUTATION,
  RESEND_BRANCH_INVITATION_MUTATION,
  CANCEL_BRANCH_INVITATION_MUTATION,
  GENERATE_NEW_BRANCH_INVITATION_MUTATION,
  type BranchesConnectionResult,
  type BranchDetailResult,
  type BranchContactNode,
  type BranchCallLogNode,
  type BranchDocumentNode,
  type BranchAgentNode,
  type BranchNode,
  VIEWER_ROLE_QUERY,
  VIEWER_BRANCH_NAME_QUERY,
  type ViewerRoleResult,
  type ViewerBranchNameResult,
  EMPLOYEES_PAGE_QUERY,
  EMPLOYEE_DETAIL_QUERY,
  INVITE_EMPLOYEE_MUTATION,
  UPDATE_EMPLOYEE_MUTATION,
  DEACTIVATE_EMPLOYEE_MUTATION,
  DELETE_EMPLOYEE_MUTATION,
  RESEND_EMPLOYEE_INVITE_MUTATION,
  CANCEL_EMPLOYEE_INVITE_MUTATION,
  type EmployeesConnectionResult,
  type EmployeeDetailResult,
  type EmployeeNode,
  type UserRole,
  type MemberStatus,
  type BranchAccessType,
} from "@/lib/graphql/queries";

export async function fetchCreditsSummary() {
  return gqlRequest<CreditsSummaryResult>(CREDITS_SUMMARY_QUERY);
}

export async function fetchHomePage() {
  return gqlRequest<HomePageResult>(HOME_PAGE_QUERY);
}

export async function fetchBillingPage(after?: string) {
  return gqlRequest<BillingPageResult>(BILLING_PAGE_QUERY, { after });
}

export async function fetchCallLogsPage(
  after?: string,
  filter?: Record<string, unknown>,
) {
  return gqlRequest<CallLogsPageResult>(CALL_LOGS_PAGE_QUERY, {
    after,
    filter,
  });
}

export async function fetchAgentsList() {
  return gqlRequest<{
    agents: {
      statusSummary: { active: number; inactive: number; total: number };
      list: Record<string, unknown>[];
    };
  }>(AGENTS_LIST_QUERY);
}

export async function fetchAgentLibraryList() {
  return gqlRequest<AgentLibraryListResult>(AGENT_LIBRARY_LIST_QUERY);
}

export async function fetchAgentLibraryBySlug(slug: string) {
  return gqlRequest<AgentLibraryBySlugResult>(AGENT_LIBRARY_BY_SLUG_QUERY, {
    slug,
  });
}

export async function fetchAgentDetail(id: string) {
  return gqlRequest<{
    agents: { byId: Record<string, unknown> | null };
  }>(AGENT_DETAIL_QUERY, { id });
}

export async function fetchAgentDetailPage(id: string) {
  return gqlRequest<{
    agents: { byId: Record<string, unknown> | null };
    phoneNumbers: { list: Record<string, unknown>[] };
    callLogs: {
      connection: {
        edges: {
          node: Record<string, unknown>;
        }[];
      };
    };
  }>(AGENT_DETAIL_PAGE_QUERY, { id });
}

export async function createAgent(input: Record<string, unknown>) {
  return gqlRequest<{
    agents: { create: Record<string, unknown> };
  }>(CREATE_AGENT_MUTATION, { input });
}

export async function updateAgent(id: string, input: Record<string, unknown>) {
  return gqlRequest<{
    agents: { update: Record<string, unknown> };
  }>(UPDATE_AGENT_MUTATION, { id, input });
}

export async function fetchPhoneNumbersPage() {
  return gqlRequest<{
    phoneNumbers: { list: Record<string, unknown>[] };
  }>(PHONE_NUMBERS_PAGE_QUERY);
}

export async function fetchPhoneNumberDetail(id: string, after?: string) {
  return gqlRequest<{
    phoneNumbers: { byId: Record<string, unknown> | null };
    callLogs: {
      connection: {
        edges: { node: Record<string, unknown>; cursor: string }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  }>(PHONE_NUMBER_DETAIL_QUERY, { id, after });
}

export async function createPhoneNumber(input: Record<string, unknown>) {
  return gqlRequest<{
    phoneNumbers: { create: Record<string, unknown> };
  }>(CREATE_PHONE_NUMBER_MUTATION, { input });
}

export async function updatePhoneNumber(
  id: string,
  input: Record<string, unknown>,
) {
  return gqlRequest<{
    phoneNumbers: { update: Record<string, unknown> };
  }>(UPDATE_PHONE_NUMBER_MUTATION, { id, input });
}

export async function fetchCallDetail(id: string) {
  return gqlRequest<{
    callLogs: { detail: Record<string, unknown> | null };
  }>(CALL_DETAIL_QUERY, { id });
}

export async function fetchLeadsReactivation(
  filter?: Record<string, unknown>,
  after?: string,
) {
  return gqlRequest<LeadsReactivationResult>(LEADS_REACTIVATION_QUERY, {
    filter,
    after,
  });
}

export async function importLeads(
  rows: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone: string;
    temperature: string;
  }[],
) {
  return gqlRequest<LeadImportResult>(IMPORT_LEADS_MUTATION, { rows });
}

export async function fetchSetupPage() {
  return gqlRequest<SetupPageResult>(SETUP_PAGE_QUERY);
}

export async function fetchSettingsPage() {
  return gqlRequest<SettingsPageResult>(SETTINGS_PAGE_QUERY);
}

export async function fetchUploadedContacts() {
  return gqlRequest<UploadedContactsListResult>(UPLOADED_CONTACTS_LIST_QUERY);
}

export async function createUploadedContact(phone: string) {
  return gqlRequest<{
    uploadedContacts: {
      create: { id: string; phone: string; createdAt: string };
    };
  }>(CREATE_UPLOADED_CONTACT_MUTATION, { phone });
}

export async function importUploadedContacts(contacts: ImportedContactInput[]) {
  return gqlRequest<UploadedContactImportResult>(
    IMPORT_UPLOADED_CONTACTS_MUTATION,
    { contacts },
  );
}

export async function deleteUploadedContact(id: string) {
  return gqlRequest<{
    uploadedContacts: { delete: boolean };
  }>(DELETE_UPLOADED_CONTACT_MUTATION, { id });
}

export async function bulkDeleteUploadedContacts(ids: string[]) {
  return gqlRequest<{
    uploadedContacts: { bulkDelete: number };
  }>(BULK_DELETE_UPLOADED_CONTACTS_MUTATION, { ids });
}

export async function fetchViewerRole() {
  return gqlRequest<ViewerRoleResult>(VIEWER_ROLE_QUERY);
}

export async function fetchViewerBranchName(branchId: string) {
  return gqlRequest<ViewerBranchNameResult>(VIEWER_BRANCH_NAME_QUERY, { id: branchId });
}

export type BranchFilterInput = {
  search?: string;
  status?: string;
  aiEnabled?: boolean;
};

export async function fetchBranchesPage(
  first = 25,
  after?: string,
  filter?: BranchFilterInput,
) {
  return gqlRequest<BranchesConnectionResult>(BRANCHES_PAGE_QUERY, {
    first,
    after,
    filter,
  });
}

export async function fetchBranchDetail(id: string) {
  return gqlRequest<BranchDetailResult>(BRANCH_DETAIL_QUERY, { id });
}

export async function fetchBranchContacts(
  branchId: string,
  first = 50,
  after?: string,
) {
  return gqlRequest<{ branches: { contacts: BranchContactNode[] } }>(
    BRANCH_CONTACTS_QUERY,
    { branchId, first, after },
  );
}

export async function fetchBranchCallLogs(
  branchId: string,
  first = 50,
  after?: string,
) {
  return gqlRequest<{ branches: { callLogs: BranchCallLogNode[] } }>(
    BRANCH_CALL_LOGS_QUERY,
    { branchId, first, after },
  );
}

export async function fetchBranchDocuments(branchId: string) {
  return gqlRequest<{ branches: { documents: BranchDocumentNode[] } }>(
    BRANCH_DOCUMENTS_QUERY,
    { branchId },
  );
}

export async function fetchBranchAgents(branchId: string) {
  return gqlRequest<{ branches: { agents: BranchAgentNode[] } }>(
    BRANCH_AGENTS_QUERY,
    { branchId },
  );
}

export async function createBranch(input: Record<string, unknown>) {
  return gqlRequest<{ branches: { create: BranchNode } }>(
    CREATE_BRANCH_MUTATION,
    { input },
  );
}

export async function updateBranch(id: string, input: Record<string, unknown>) {
  return gqlRequest<{ branches: { update: BranchNode } }>(
    UPDATE_BRANCH_MUTATION,
    { id, input },
  );
}

export async function updateBranchAi(
  id: string,
  input: Record<string, unknown>,
) {
  return gqlRequest<{ branches: { updateAi: BranchNode } }>(
    UPDATE_BRANCH_AI_MUTATION,
    { id, input },
  );
}

export async function bulkUpdateBranches(input: {
  ids: string[];
  action:
    | "ENABLE_AI"
    | "DISABLE_AI"
    | "UPDATE_PROMPT"
    | "CHANGE_STATUS"
    | "ARCHIVE";
  systemPrompt?: string;
  status?: string;
}) {
  return gqlRequest<{ branches: { bulkUpdate: { updated: number } } }>(
    BULK_UPDATE_BRANCHES_MUTATION,
    { input },
  );
}

export async function archiveBranch(id: string) {
  return gqlRequest<{ branches: { archive: BranchNode } }>(
    ARCHIVE_BRANCH_MUTATION,
    { id },
  );
}

export type EmployeeFilterInput = {
  search?: string;
  role?: UserRole;
  status?: MemberStatus;
  branchId?: string;
};

export async function fetchEmployeesPage(
  first = 25,
  after?: string,
  filter?: EmployeeFilterInput,
) {
  return gqlRequest<EmployeesConnectionResult>(EMPLOYEES_PAGE_QUERY, {
    first,
    after,
    filter,
  });
}

export async function fetchEmployeeDetail(id: string, role: UserRole) {
  return gqlRequest<EmployeeDetailResult>(EMPLOYEE_DETAIL_QUERY, { id, role });
}

export async function inviteEmployee(input: {
  name: string;
  email: string;
  role: UserRole;
  jobTitle?: string;
  branchAccessType: BranchAccessType;
  branchIds?: string[];
}) {
  return gqlRequest<{ employees: { invite: EmployeeNode } }>(
    INVITE_EMPLOYEE_MUTATION,
    { input },
  );
}

export async function updateEmployee(
  id: string,
  input: Record<string, unknown>,
) {
  return gqlRequest<{ employees: { update: EmployeeNode } }>(
    UPDATE_EMPLOYEE_MUTATION,
    { id, input },
  );
}

export async function deactivateEmployee(id: string) {
  return gqlRequest<{ employees: { deactivate: EmployeeNode } }>(
    DEACTIVATE_EMPLOYEE_MUTATION,
    { id },
  );
}

export async function deleteEmployee(id: string) {
  return gqlRequest<{ employees: { delete: boolean } }>(
    DELETE_EMPLOYEE_MUTATION,
    { id },
  );
}

export async function resendEmployeeInvite(id: string) {
  return gqlRequest<{ employees: { resendInvite: EmployeeNode } }>(
    RESEND_EMPLOYEE_INVITE_MUTATION,
    { id },
  );
}

export async function cancelEmployeeInvite(id: string) {
  return gqlRequest<{ employees: { cancelInvite: boolean } }>(
    CANCEL_EMPLOYEE_INVITE_MUTATION,
    { id },
  );
}

/** @deprecated Use fetchHomePage */
export const fetchHomeDashboard = fetchHomePage;

/** @deprecated Use fetchAgentsList */
export const fetchAgentsPage = fetchAgentsList;

export async function resendBranchInvitation(branchId: string) {
  return gqlRequest<{ branches: { resendInvitation: BranchNode } }>(
    RESEND_BRANCH_INVITATION_MUTATION,
    { branchId },
  );
}

export async function cancelBranchInvitation(branchId: string) {
  return gqlRequest<{ branches: { cancelInvitation: BranchNode } }>(
    CANCEL_BRANCH_INVITATION_MUTATION,
    { branchId },
  );
}

export async function generateNewBranchInvitation(branchId: string) {
  return gqlRequest<{ branches: { generateNewInvitation: BranchNode } }>(
    GENERATE_NEW_BRANCH_INVITATION_MUTATION,
    { branchId },
  );
}

import { BRANCH_DASHBOARD_QUERY, type BranchDashboardResult } from "./queries/home";

export async function fetchBranchDashboardPage(
  branchId: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return gqlRequest<BranchDashboardResult>(BRANCH_DASHBOARD_QUERY, {
    branchId,
    dateFrom,
    dateTo,
  });
}
