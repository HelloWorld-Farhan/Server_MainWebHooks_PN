import type { TenantContext } from "@/server/types/context";
import { agentsService } from "@/server/services/agents.service";
import { agentLibraryService } from "@/server/services/agent-library.service";
import { analyticsService } from "@/server/services/analytics.service";
import { billingService } from "@/server/services/billing.service";
import { branchesService } from "@/server/services/branches.service";
import { callLogsService } from "@/server/services/call-logs.service";
import { campaignsService } from "@/server/services/campaigns.service";
import { creditsService } from "@/server/services/credits.service";
import { employeesService } from "@/server/services/employees.service";
import { eventsService } from "@/server/services/events.service";
import { leadsService } from "@/server/services/leads.service";
import { phoneNumbersService } from "@/server/services/phone-numbers.service";
import {
  integrationsService,
  notificationsService,
  schedulerService,
} from "@/server/services/notifications.service";
import { uploadedContactsService } from "@/server/services/uploaded-contacts.service";
import { tenantService } from "@/server/services/tenant.service";

function parseCallLogFilter(filter?: {
  direction?: string;
  status?: string;
  aiAgentId?: string;
  phoneNumberId?: string;
  assignedUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}) {
  if (!filter) return undefined;
  return {
    direction: filter.direction as never,
    status: filter.status as never,
    aiAgentId: filter.aiAgentId,
    phoneNumberId: filter.phoneNumberId,
    assignedUserId: filter.assignedUserId,
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    search: filter.search,
  };
}

function parseLeadFilter(filter?: {
  dormantOnly?: boolean;
  minDaysInactive?: number;
  temperature?: string;
}) {
  if (!filter) return undefined;
  return {
    dormantOnly: filter.dormantOnly,
    minDaysInactive: filter.minDaysInactive,
    temperature: filter.temperature as never,
  };
}

export const resolvers = {
  Query: {
    viewer: (_: unknown, __: unknown, ctx: TenantContext) =>
      tenantService.getViewer(ctx),
    credits: () => ({}),
    billing: () => ({}),
    callLogs: () => ({}),
    analytics: () => ({}),
    agents: () => ({}),
    agentLibrary: () => ({}),
    phoneNumbers: () => ({}),
    uploadedContacts: () => ({}),
    leads: () => ({}),
    campaigns: () => ({}),
    notifications: () => ({}),
    integrations: () => ({}),
    scheduler: () => ({}),
    events: () => ({}),
    branches: () => ({}),
    employees: () => ({}),
  },

  Mutation: {
    credits: () => ({}),
    callLogs: () => ({}),
    agents: () => ({}),
    phoneNumbers: () => ({}),
    uploadedContacts: () => ({}),
    leads: () => ({}),
    branches: () => ({}),
    employees: () => ({}),
  },

  CreditsQueries: {
    summary: (_: unknown, __: unknown, ctx: TenantContext) =>
      creditsService.getSummary(ctx),
    usageHistory: (
      _: unknown,
      args: { first?: number; after?: string },
      ctx: TenantContext,
    ) => creditsService.getUsageHistory(ctx, args),
  },

  CreditsMutations: {
    adjustCredits: (
      _: unknown,
      args: { amount: number; description: string },
      ctx: TenantContext,
    ) => creditsService.adjustCredits(ctx, args.amount, args.description),
  },

  BillingQueries: {
    subscription: (_: unknown, __: unknown, ctx: TenantContext) =>
      billingService.getSubscription(ctx),
    invoices: (
      _: unknown,
      args: { first?: number; after?: string },
      ctx: TenantContext,
    ) => billingService.getInvoices(ctx, args),
  },

  CallLogsQueries: {
    recent: (_: unknown, args: { limit?: number }, ctx: TenantContext) =>
      callLogsService.getRecent(ctx, args.limit),
    connection: (
      _: unknown,
      args: {
        first?: number;
        after?: string;
        filter?: Parameters<typeof parseCallLogFilter>[0];
      },
      ctx: TenantContext,
    ) =>
      callLogsService.getConnection(ctx, {
        first: args.first,
        after: args.after,
        filter: parseCallLogFilter(args.filter),
      }),
    detail: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      callLogsService.getDetail(ctx, args.id),
  },

  CallLogsMutations: {
    recordCallCompleted: async (
      _: unknown,
      args: { callLogId: string; creditsUsed: number },
      ctx: TenantContext,
    ) => {
      await creditsService.debitForCall(
        ctx,
        args.callLogId,
        args.creditsUsed,
      );
      await callLogsService.onCallCompleted(ctx.companyId, {
        totalCalls: 1,
        connectedCalls: 1,
      });
      return true;
    },
  },

  AnalyticsQueries: {
    summary: (
      _: unknown,
      args: {
        granularity?: "DAILY" | "WEEKLY" | "MONTHLY";
        dateFrom?: string;
        dateTo?: string;
      },
      ctx: TenantContext,
    ) =>
      analyticsService.getSummary(
        ctx,
        args.granularity,
        args.dateFrom ? new Date(args.dateFrom) : undefined,
        args.dateTo ? new Date(args.dateTo) : undefined,
      ),
  },

  AgentsQueries: {
    statusSummary: (_: unknown, __: unknown, ctx: TenantContext) =>
      agentsService.getStatusSummary(ctx),
    list: (_: unknown, __: unknown, ctx: TenantContext) =>
      agentsService.list(ctx),
    byId: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      agentsService.getById(ctx, args.id),
  },

  AgentsMutations: {
    create: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => agentsService.create(ctx, args.input as never),
    update: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => agentsService.update(ctx, args.id, args.input as never),
  },

  AgentLibraryQueries: {
    list: (_: unknown, __: unknown, ctx: TenantContext) =>
      agentLibraryService.list(ctx),
    bySlug: (_: unknown, args: { slug: string }, ctx: TenantContext) =>
      agentLibraryService.getBySlug(ctx, args.slug),
  },

  PhoneNumbersQueries: {
    list: (_: unknown, __: unknown, ctx: TenantContext) =>
      phoneNumbersService.list(ctx),
    byId: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      phoneNumbersService.getById(ctx, args.id),
  },

  PhoneNumbersMutations: {
    create: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => phoneNumbersService.create(ctx, args.input as never),
    update: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => phoneNumbersService.update(ctx, args.id, args.input as never),
  },

  UploadedContactsQueries: {
    list: (_: unknown, __: unknown, ctx: TenantContext) =>
      uploadedContactsService.list(ctx),
  },

  UploadedContactsMutations: {
    create: (
      _: unknown,
      args: { phone: string },
      ctx: TenantContext,
    ) => uploadedContactsService.create(ctx, args.phone),
    importContacts: (
      _: unknown,
      args: {
        contacts: Array<{
          phone: string;
          name?: string | null;
          email?: string | null;
          address?: string | null;
          branchNames?: string[];
        }>;
      },
      ctx: TenantContext,
    ) => uploadedContactsService.importContacts(ctx, args.contacts),
    delete: (
      _: unknown,
      args: { id: string },
      ctx: TenantContext,
    ) => uploadedContactsService.delete(ctx, args.id),
    bulkDelete: (
      _: unknown,
      args: { ids: string[] },
      ctx: TenantContext,
    ) => uploadedContactsService.bulkDelete(ctx, args.ids),
  },

  LeadsQueries: {
    connection: (
      _: unknown,
      args: {
        first?: number;
        after?: string;
        filter?: Parameters<typeof parseLeadFilter>[0];
      },
      ctx: TenantContext,
    ) =>
      leadsService.getConnection(ctx, {
        first: args.first,
        after: args.after,
        filter: parseLeadFilter(args.filter),
      }),
    byId: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      leadsService.getById(ctx, args.id),
    temperatureBreakdown: (_: unknown, __: unknown, ctx: TenantContext) =>
      leadsService.getTemperatureBreakdown(ctx),
  },

  LeadsMutations: {
    importRows: (
      _: unknown,
      args: {
        rows: {
          firstName?: string | null;
          lastName?: string | null;
          email?: string | null;
          phone: string;
          temperature: string;
        }[];
      },
      ctx: TenantContext,
    ) => leadsService.importRows(ctx, args.rows),
  },

  CampaignsQueries: {
    list: (_: unknown, __: unknown, ctx: TenantContext) =>
      campaignsService.list(ctx),
  },

  NotificationQueries: {
    list: (
      _: unknown,
      args: { first?: number; after?: string },
      ctx: TenantContext,
    ) => notificationsService.list(ctx, args),
  },

  IntegrationQueries: {
    list: (_: unknown, __: unknown, ctx: TenantContext) =>
      integrationsService.list(ctx),
  },

  SchedulerQueries: {
    upcoming: (_: unknown, args: { limit?: number }, ctx: TenantContext) =>
      schedulerService.listUpcoming(ctx, args.limit),
  },

  EventQueries: {
    recent: (_: unknown, args: { limit?: number }, ctx: TenantContext) =>
      eventsService.listRecent(ctx, args.limit),
  },

  BranchesQueries: {
    connection: (
      _: unknown,
      args: {
        first?: number;
        after?: string;
        filter?: { search?: string; status?: string; aiEnabled?: boolean };
      },
      ctx: TenantContext,
    ) =>
      branchesService.getConnection(ctx, {
        first: args.first,
        after: args.after,
        filter: args.filter
          ? {
              search: args.filter.search,
              status: args.filter.status as never,
              aiEnabled: args.filter.aiEnabled,
            }
          : undefined,
      }),
    byId: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      branchesService.getById(ctx, args.id),
    contacts: (
      _: unknown,
      args: { branchId: string; first?: number; after?: string },
      ctx: TenantContext,
    ) => branchesService.getContacts(ctx, args.branchId, args.first, args.after),
    callLogs: (
      _: unknown,
      args: { branchId: string; first?: number; after?: string },
      ctx: TenantContext,
    ) => branchesService.getCallLogs(ctx, args.branchId, args.first, args.after),
    documents: (
      _: unknown,
      args: { branchId: string },
      ctx: TenantContext,
    ) => branchesService.getDocuments(ctx, args.branchId),
    activities: (
      _: unknown,
      args: { branchId: string; limit?: number },
      ctx: TenantContext,
    ) => branchesService.getActivities(ctx, args.branchId, args.limit),
    agents: (
      _: unknown,
      args: { branchId: string },
      ctx: TenantContext,
    ) => branchesService.getAgents(ctx, args.branchId),
  },

  BranchesMutations: {
    create: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => branchesService.create(ctx, args.input as never),
    update: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => branchesService.update(ctx, args.id, args.input as never),
    updateAi: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => branchesService.updateAi(ctx, args.id, args.input as never),
    bulkUpdate: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => branchesService.bulkUpdate(ctx, args.input as never),
    archive: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      branchesService.archive(ctx, args.id),
    resendInvitation: (
      _: unknown,
      args: { branchId: string },
      ctx: TenantContext,
    ) => branchesService.resendInvitation(ctx, args.branchId),
    cancelInvitation: (
      _: unknown,
      args: { branchId: string },
      ctx: TenantContext,
    ) => branchesService.cancelInvitation(ctx, args.branchId),
    generateNewInvitation: (
      _: unknown,
      args: { branchId: string },
      ctx: TenantContext,
    ) => branchesService.generateNewInvitation(ctx, args.branchId),
  },

  EmployeesQueries: {
    connection: (
      _: unknown,
      args: { first?: number; after?: string; filter?: Record<string, unknown> },
      ctx: TenantContext,
    ) => employeesService.getConnection(ctx, args),
    byId: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      employeesService.getById(ctx, args.id),
    permissionsForRole: (
      _: unknown,
      args: { role: TenantContext["role"] },
      ctx: TenantContext,
    ) => employeesService.getPermissionsForRole(ctx, args.role),
  },

  EmployeesMutations: {
    invite: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => employeesService.invite(ctx, args.input as never),
    update: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => employeesService.update(ctx, args.id, args.input as never),
    deactivate: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      employeesService.deactivate(ctx, args.id),
    delete: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      employeesService.delete(ctx, args.id),
    resendInvite: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      employeesService.resendInvite(ctx, args.id),
    cancelInvite: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      employeesService.cancelInvite(ctx, args.id),
  },

  UploadedContact: {
    branches: (
      parent: { branchIds?: string[] | null },
      _: unknown,
      ctx: TenantContext,
    ) =>
      Promise.all(
        (parent.branchIds ?? []).map((id) => ctx.loaders.branch.load(id)),
      ).then((branches) => branches.filter((branch) => branch !== null)),
  },

  CallLog: {
    lead: (parent: { leadId?: string | null }, _: unknown, ctx: TenantContext) =>
      parent.leadId ? ctx.loaders.lead.load(parent.leadId) : null,
    aiAgent: (
      parent: { aiAgentId?: string | null },
      _: unknown,
      ctx: TenantContext,
    ) => (parent.aiAgentId ? ctx.loaders.aiAgent.load(parent.aiAgentId) : null),
    phoneNumber: (
      parent: { phoneNumberId?: string | null },
      _: unknown,
      ctx: TenantContext,
    ) =>
      parent.phoneNumberId
        ? ctx.loaders.phoneNumber.load(parent.phoneNumberId)
        : null,
  },

  CreditUsage: {
    createdAt: (parent: { createdAt: Date | string }) =>
      typeof parent.createdAt === "string"
        ? parent.createdAt
        : parent.createdAt.toISOString(),
    reason: (parent: { reason: string }) => parent.reason,
  },

  BillingInvoice: {
    issuedAt: (parent: { issuedAt: Date }) => parent.issuedAt.toISOString(),
    dueAt: (parent: { dueAt?: Date | null }) =>
      parent.dueAt?.toISOString() ?? null,
    paidAt: (parent: { paidAt?: Date | null }) =>
      parent.paidAt?.toISOString() ?? null,
  },

  Notification: {
    createdAt: (parent: { createdAt: Date }) => parent.createdAt.toISOString(),
    readAt: (parent: { readAt?: Date | null }) =>
      parent.readAt?.toISOString() ?? null,
  },

  Integration: {
    lastSyncAt: (parent: { lastSyncAt?: Date | null }) =>
      parent.lastSyncAt?.toISOString() ?? null,
  },

  SchedulerEvent: {
    startAt: (parent: { startAt: Date }) => parent.startAt.toISOString(),
    endAt: (parent: { endAt?: Date | null }) =>
      parent.endAt?.toISOString() ?? null,
  },

  SystemEvent: {
    createdAt: (parent: { createdAt: Date }) => parent.createdAt.toISOString(),
  },
};
