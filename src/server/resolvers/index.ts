import type { TenantContext } from "@/server/types/context";
import prisma from "@/server/lib/prisma";
import { agentsService } from "@/server/services/agents.service";
import { agentLibraryService } from "@/server/services/agent-library.service";
import { analyticsService } from "@/server/services/analytics.service";
import { apiKeysService } from "@/server/services/api-keys.service";
import { billingService } from "@/server/services/billing.service";
import { campaignsService } from "@/server/services/campaigns.service";
import { callLogsService } from "@/server/services/call-logs.service";
import { outboundCampaignsService } from "@/server/services/outbound-campaigns.service";
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
  campaignId?: string;
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
    campaignId: filter.campaignId,
    phoneNumberId: filter.phoneNumberId,
    assignedUserId: filter.assignedUserId,
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    search: filter.search,
  };
}

function parsePhoneNumberFilter(filter?: {
  number?: string;
  numberContains?: string;
  labelContains?: string;
  search?: string;
  provider?: string;
  status?: string;
  inboundAgentId?: string;
  outboundAgentId?: string;
  hasInboundAgent?: boolean;
  hasOutboundAgent?: boolean;
  channelIndex?: number;
  hasChannelAssignment?: boolean;
  createdFrom?: string;
  createdTo?: string;
  lastActivityFrom?: string;
  lastActivityTo?: string;
  ids?: string[];
}) {
  if (!filter) return undefined;
  return {
    number: filter.number,
    numberContains: filter.numberContains,
    labelContains: filter.labelContains,
    search: filter.search,
    provider: filter.provider as never,
    status: filter.status as never,
    inboundAgentId: filter.inboundAgentId,
    outboundAgentId: filter.outboundAgentId,
    hasInboundAgent: filter.hasInboundAgent,
    hasOutboundAgent: filter.hasOutboundAgent,
    channelIndex: filter.channelIndex,
    hasChannelAssignment: filter.hasChannelAssignment,
    createdFrom: filter.createdFrom
      ? new Date(filter.createdFrom)
      : undefined,
    createdTo: filter.createdTo ? new Date(filter.createdTo) : undefined,
    lastActivityFrom: filter.lastActivityFrom
      ? new Date(filter.lastActivityFrom)
      : undefined,
    lastActivityTo: filter.lastActivityTo
      ? new Date(filter.lastActivityTo)
      : undefined,
    ids: filter.ids,
  };
}

function parsePhoneNumberSort(sort?: {
  field?: string;
  direction?: string;
}) {
  if (!sort?.field) return undefined;
  return {
    field: sort.field as
      | "CREATED_AT"
      | "UPDATED_AT"
      | "LAST_ACTIVITY_AT"
      | "NUMBER"
      | "INBOUND_CALLS_COUNT"
      | "OUTBOUND_CALLS_COUNT",
    direction: (sort.direction === "ASC" ? "ASC" : "DESC") as "ASC" | "DESC",
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
    outboundCampaigns: () => ({}),
    notifications: () => ({}),
    integrations: () => ({}),
    scheduler: () => ({}),
    events: () => ({}),
    campaigns: () => ({}),
    employees: () => ({}),
    apiKeys: () => ({}),
  },

  Mutation: {
    credits: () => ({}),
    callLogs: () => ({}),
    agents: () => ({}),
    phoneNumbers: () => ({}),
    uploadedContacts: () => ({}),
    leads: () => ({}),
    outboundCampaigns: () => ({}),
    campaigns: () => ({}),
    employees: () => ({}),
    apiKeys: () => ({}),
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
    rates: (_: unknown, __: unknown, ctx: TenantContext) =>
      billingService.getRates(ctx),
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
      args: { callLogId: string },
      ctx: TenantContext,
    ) => callLogsService.recordCompletedWithBilling(ctx, args.callLogId),
    updateOutcome: (
      _: unknown,
      args: {
        id: string;
        outcome: string;
        reactivationPlan?: Record<string, unknown> | null;
      },
      ctx: TenantContext,
    ) =>
      callLogsService.updateOutcome(
        ctx,
        args.id,
        args.outcome,
        args.reactivationPlan,
      ),
    addInternalNote: (
      _: unknown,
      args: { callLogId: string; content: string },
      ctx: TenantContext,
    ) => callLogsService.addInternalNote(ctx, args.callLogId, args.content),
    updateInternalNote: (
      _: unknown,
      args: { id: string; content: string },
      ctx: TenantContext,
    ) => callLogsService.updateInternalNote(ctx, args.id, args.content),
    deleteInternalNote: (
      _: unknown,
      args: { id: string },
      ctx: TenantContext,
    ) => callLogsService.deleteInternalNote(ctx, args.id),
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
    timeSeries: (
      _: unknown,
      args: {
        granularity?: "DAILY" | "WEEKLY" | "MONTHLY";
        dateFrom?: string;
        dateTo?: string;
      },
      ctx: TenantContext,
    ) =>
      analyticsService.getTimeSeries(
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
    list: (
      _: unknown,
      args: {
        filter?: Parameters<typeof parsePhoneNumberFilter>[0];
        sort?: Parameters<typeof parsePhoneNumberSort>[0];
      },
      ctx: TenantContext,
    ) =>
      phoneNumbersService.list(
        ctx,
        parsePhoneNumberFilter(args.filter),
        parsePhoneNumberSort(args.sort),
      ),
    connection: (
      _: unknown,
      args: {
        first?: number;
        after?: string;
        filter?: Parameters<typeof parsePhoneNumberFilter>[0];
        sort?: Parameters<typeof parsePhoneNumberSort>[0];
      },
      ctx: TenantContext,
    ) =>
      phoneNumbersService.getConnection(ctx, {
        first: args.first,
        after: args.after,
        filter: parsePhoneNumberFilter(args.filter),
        sort: parsePhoneNumberSort(args.sort),
      }),
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
          field1?: string | null;
          field2?: string | null;
          field3?: string | null;
          campaignNames?: string[];
          campaignIds?: string[];
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

  OutboundCampaignsQueries: {
    list: (_: unknown, __: unknown, ctx: TenantContext) =>
      outboundCampaignsService.list(ctx),
  },

  OutboundCampaignsMutations: {
    create: (
      _: unknown,
      args: { input: { name: string; aiAgentId?: string | null } },
      ctx: TenantContext,
    ) => outboundCampaignsService.create(ctx, args.input),
    launch: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      outboundCampaignsService.launch(ctx, args.id),
    pause: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      outboundCampaignsService.pause(ctx, args.id),
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

  CampaignsQueries: {
    connection: (
      _: unknown,
      args: {
        first?: number;
        after?: string;
        filter?: { search?: string; status?: string; aiEnabled?: boolean };
      },
      ctx: TenantContext,
    ) =>
      campaignsService.getConnection(ctx, {
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
      campaignsService.getById(ctx, args.id),
    contacts: (
      _: unknown,
      args: { campaignId: string; first?: number; after?: string },
      ctx: TenantContext,
    ) => campaignsService.getContacts(ctx, args.campaignId, args.first, args.after),
    callLogs: (
      _: unknown,
      args: { campaignId: string; first?: number; after?: string },
      ctx: TenantContext,
    ) => campaignsService.getCallLogs(ctx, args.campaignId, args.first, args.after),
    documents: (
      _: unknown,
      args: { campaignId: string },
      ctx: TenantContext,
    ) => campaignsService.getDocuments(ctx, args.campaignId),
    activities: (
      _: unknown,
      args: { campaignId: string; limit?: number },
      ctx: TenantContext,
    ) => campaignsService.getActivities(ctx, args.campaignId, args.limit),
    agents: (
      _: unknown,
      args: { campaignId: string },
      ctx: TenantContext,
    ) => campaignsService.getAgents(ctx, args.campaignId),
  },

  CampaignsMutations: {
    create: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => campaignsService.create(ctx, args.input as never),
    update: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => campaignsService.update(ctx, args.id, args.input as never),
    updateAi: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => campaignsService.updateAi(ctx, args.id, args.input as never),
    bulkUpdate: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => campaignsService.bulkUpdate(ctx, args.input as never),
    bulkDelete: (
      _: unknown,
      args: { ids: string[] },
      ctx: TenantContext,
    ) => campaignsService.bulkDelete(ctx, args.ids),
    archive: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      campaignsService.archive(ctx, args.id),
    delete: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      campaignsService.delete(ctx, args.id),
    resendInvitation: (
      _: unknown,
      args: { campaignId: string },
      ctx: TenantContext,
    ) => campaignsService.resendInvitation(ctx, args.campaignId),
    cancelInvitation: (
      _: unknown,
      args: { campaignId: string },
      ctx: TenantContext,
    ) => campaignsService.cancelInvitation(ctx, args.campaignId),
    generateNewInvitation: (
      _: unknown,
      args: { campaignId: string },
      ctx: TenantContext,
    ) => campaignsService.generateNewInvitation(ctx, args.campaignId),
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
    campaigns: (
      parent: { campaignIds?: string[] | null },
      _: unknown,
      ctx: TenantContext,
    ) =>
      Promise.all(
        (parent.campaignIds ?? []).map((id) => ctx.loaders.campaign.load(id)),
      ).then((campaigns) => campaigns.filter((campaign) => campaign !== null)),
  },

  Campaign: {
    execution: async (
      parent: { id: string; companyId?: string },
      _: unknown,
      ctx: TenantContext,
    ) => {
      const execution = await prisma.campaignExecution.findFirst({
        where: {
          companyId: parent.companyId ?? ctx.companyId,
          campaignId: parent.id,
        },
        select: {
          status: true,
          scheduledAt: true,
          totalContacts: true,
        },
      });

      if (!execution) return null;

      return {
        status: execution.status,
        scheduledAt: execution.scheduledAt?.toISOString() ?? null,
        totalContacts: execution.totalContacts,
      };
    },
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
    campaign: async (
      parent: { campaignId?: string | null },
      _: unknown,
      ctx: TenantContext,
    ) => {
      if (!parent.campaignId) return null;
      const campaign = await ctx.loaders.campaign.load(parent.campaignId);
      if (!campaign) return null;
      return {
        ...campaign,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
        lastActivityAt: campaign.lastActivityAt?.toISOString() ?? null,
      };
    },
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

  ApiKeysQueries: {
    connection: (
      _: unknown,
      args: {
        first?: number;
        after?: string;
        filter?: {
          search?: string;
          status?: string;
          environment?: string;
        };
      },
      ctx: TenantContext,
    ) =>
      apiKeysService.getConnection(ctx, {
        first: args.first,
        after: args.after,
        filter: args.filter as never,
      }),
    byId: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      apiKeysService.getById(ctx, args.id),
    availableScopes: (_: unknown, __: unknown, ctx: TenantContext) =>
      apiKeysService.listAvailableScopes(ctx),
    accessibleCampaigns: (_: unknown, __: unknown, ctx: TenantContext) =>
      apiKeysService.listAccessibleCampaigns(ctx),
  },

  ApiKeysMutations: {
    create: (
      _: unknown,
      args: { input: Record<string, unknown> },
      ctx: TenantContext,
    ) => apiKeysService.create(ctx, args.input as never),
    update: (
      _: unknown,
      args: { id: string; input: Record<string, unknown> },
      ctx: TenantContext,
    ) => apiKeysService.update(ctx, args.id, args.input as never),
    enable: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      apiKeysService.enable(ctx, args.id),
    disable: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      apiKeysService.disable(ctx, args.id),
    delete: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      apiKeysService.delete(ctx, args.id),
    regenerate: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      apiKeysService.regenerate(ctx, args.id),
    rotateSecret: (_: unknown, args: { id: string }, ctx: TenantContext) =>
      apiKeysService.rotateSecret(ctx, args.id),
    updateScopes: (
      _: unknown,
      args: { id: string; scopes: string[] },
      ctx: TenantContext,
    ) => apiKeysService.updateScopes(ctx, args.id, args.scopes),
    updateCampaignAccess: (
      _: unknown,
      args: {
        id: string;
        input: { campaignAccessType: string; campaignIds?: string[] };
      },
      ctx: TenantContext,
    ) => apiKeysService.updateCampaignAccess(ctx, args.id, args.input as never),
    updateExpiration: (
      _: unknown,
      args: { id: string; expiresAt?: string | null },
      ctx: TenantContext,
    ) =>
      apiKeysService.updateExpiration(
        ctx,
        args.id,
        args.expiresAt === undefined ? null : args.expiresAt,
      ),
  },
};
