import { randomUUID } from "crypto";
import type { CampaignStatus, Prisma } from "@prisma/client";

import { NotFoundError, ValidationError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import {
  CampaignsRepository,
  type CampaignFilter,
} from "@/server/repositories/campaigns.repository";
import { buildConnection, encodeIdCursor } from "@/server/lib/pagination";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { campaignAccessService } from "@/server/services/campaign-access.service";
import { tenantService } from "@/server/services/tenant.service";
import { clerkOrgLib } from "@/lib/clerk/organization";
import { getCampaignInviteRedirectUrl } from "@/lib/app-url";

type CampaignRow = Awaited<
  ReturnType<CampaignsRepository["findById"]>
>;

function mapBranch(
  row: NonNullable<CampaignRow>,
  counts?: {
    contactsCount: number;
    callLogsCount: number;
    documentsCount: number;
    agentsCount: number;
  },
  invitationEmailSent?: boolean,
) {
  const r = row as any;
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    address: r.address,
    phone: r.phone,
    email: r.email,
    notes: r.notes,
    customFields: r.customFields,
    aiEnabled: r.aiEnabled,
    systemPrompt: r.systemPrompt,
    aiConfig: r.aiConfig,
    contactsCount: counts?.contactsCount ?? 0,
    callLogsCount: counts?.callLogsCount ?? 0,
    documentsCount: counts?.documentsCount ?? 0,
    agentsCount: counts?.agentsCount ?? 0,
    lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    invitationEmailSent: typeof invitationEmailSent === "boolean" ? invitationEmailSent : null,
    invitation: r.invitation
      ? {
          id: r.invitation.id,
          email: r.invitation.email,
          token: r.invitation.token,
          status: r.invitation.status,
          createdAt: r.invitation.createdAt.toISOString(),
          updatedAt: r.invitation.updatedAt.toISOString(),
          sentAt: r.invitation.sentAt.toISOString(),
          acceptedAt: r.invitation.acceptedAt?.toISOString() ?? null,
          expiresAt: r.invitation.expiresAt.toISOString(),
        }
      : null,
  };
}

function mapAgent(row: {
  id: string;
  name: string;
  type: string;
  category: string | null;
  status: string;
  environment: string;
  enabled: boolean;
  languages: string[];
  firstMessage: string | null;
  systemPrompt: string | null;
  voiceConfig: unknown;
  modelConfig: unknown;
  transcriberConfig: unknown;
  serverConfig: unknown;
  structuredOutputs: unknown;
  scorecards: unknown;
  monitors: unknown;
  demoAudioUrl: string | null;
  campaignId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    status: row.status,
    environment: row.environment,
    enabled: row.enabled,
    languages: row.languages,
    firstMessage: row.firstMessage,
    systemPrompt: row.systemPrompt,
    voiceConfig: row.voiceConfig,
    modelConfig: row.modelConfig,
    transcriberConfig: row.transcriberConfig,
    serverConfig: row.serverConfig,
    structuredOutputs: row.structuredOutputs,
    scorecards: row.scorecards,
    monitors: row.monitors,
    demoAudioUrl: row.demoAudioUrl,
    campaignId: row.campaignId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CampaignConnectionArgs = {
  first?: number;
  after?: string;
  filter?: CampaignFilter;
};

export class CampaignsService {
  private readonly repo = new CampaignsRepository(prisma);

  async getConnection(ctx: TenantContext, args: CampaignConnectionArgs) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    const limit = Math.min(Math.max(args.first ?? 25, 1), 200);

    const scopeWhere = campaignAccessService.campaignIdScopeFilter(ctx);
    const [rows, totalCount] = await Promise.all([
      this.repo.findConnection(ctx.companyId, limit, args.after, args.filter, scopeWhere),
      this.repo.count(ctx.companyId, args.filter, scopeWhere),
    ]);

    const connection = buildConnection(rows, limit, (row) =>
      encodeIdCursor(row.id, row.createdAt),
    );

    return {
      edges: connection.edges.map((edge) => ({
        node: mapBranch(edge.node),
        cursor: edge.cursor,
      })),
      pageInfo: connection.pageInfo,
      totalCount,
    };
  }

  async getById(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    campaignAccessService.assertCampaignAccess(ctx, id);
    const row = await this.repo.findById(ctx.companyId, id);
    if (!row) throw new NotFoundError("Campaign not found");
    const counts = await this.repo.countRelations(ctx.companyId, id);
    return mapBranch(row, counts);
  }

  async create(
    ctx: TenantContext,
    input: {
      name: string;
      status?: CampaignStatus;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      customFields?: Prisma.InputJsonValue;
      aiEnabled?: boolean;
      systemPrompt?: string | null;
      aiConfig?: Prisma.InputJsonValue;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const name = input.name?.trim();
    if (!name) throw new ValidationError("Campaign name is required");

    const creator = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const createdByName = creator
      ? [creator.firstName, creator.lastName].filter(Boolean).join(" ") ||
        creator.email
      : undefined;

    const row = await this.repo.create(ctx.companyId, {
      name,
      status: input.status,
      address: input.address ?? undefined,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      notes: input.notes ?? undefined,
      customFields: {
        ...((input.customFields as Record<string, unknown>) ?? {}),
        ...(createdByName ? { createdByName } : {}),
      },
      aiEnabled: input.aiEnabled ?? false,
      systemPrompt: input.systemPrompt ?? undefined,
      aiConfig: input.aiConfig ?? {},
      lastActivityAt: new Date(),
    });

    await this.repo.createActivity(ctx.companyId, row.id, {
      type: "CAMPAIGN_CREATED",
      summary: `Campaign "${row.name}" created`,
      actorId: ctx.userId,
    });

    let invitationEmailSent = false;
    const emailVal = input.email?.trim().toLowerCase();

    if (emailVal) {
      const company = await prisma.company.findUnique({
        where: { id: ctx.companyId },
      });
      if (!company) throw new NotFoundError("Company not found");
      const clerkOrganizationId = await clerkOrgLib.getActiveClerkOrganizationId(company, {
        createdByClerkUserId: ctx.clerkUserId,
      });

      // Revoke any existing invitations in Clerk for this email address to avoid duplicates
      await clerkOrgLib.removeClerkOrganizationAccess({
        organizationId: clerkOrganizationId,
        email: emailVal,
        requestingUserId: ctx.clerkUserId,
      });

      // Generate the token before sending the Clerk invitation so the redirect
      // URL embedded in the email already points at /invitations/campaign/{token}.
      // This ensures the user lands on the acceptance page and the
      // acceptInvitation server action fires — which is the only path that
      // sets CampaignInvitation.status = ACCEPTED.
      const token = randomUUID();

      const clerkInvite = await clerkOrgLib.sendClerkOrganizationInvitation({
        organizationId: clerkOrganizationId,
        email: emailVal,
        role: "ADMIN",
        inviterUserId: ctx.clerkUserId,
        redirectUrl: getCampaignInviteRedirectUrl(token),
        metadata: {
          propnexRole: "ADMIN",
          campaignAccessType: "SELECTED",
          campaignIds: [row.id],
          jobTitle: "Campaign Admin",
          inviteName: row.name,
        },
      });

      const expiresAt = clerkInvite.expiresAt;

      await prisma.campaignInvitation.create({
        data: {
          companyId: ctx.companyId,
          campaignId: row.id,
          email: emailVal,
          token,
          expiresAt,
          clerkInvitationId: clerkInvite.invitationId,
          clerkOrganizationId,
        },
      });

      invitationEmailSent = true;

      // Reload row so the invitation is populated
      const reloaded = await this.repo.findById(ctx.companyId, row.id);
      if (reloaded) {
        return mapBranch(reloaded, undefined, invitationEmailSent);
      }
    }

    return mapBranch(row);
  }

  async update(
    ctx: TenantContext,
    id: string,
    input: {
      name?: string;
      status?: CampaignStatus;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      customFields?: Prisma.InputJsonValue;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Campaign not found");
    campaignAccessService.assertCampaignAccess(ctx, id);

    await this.repo.update(ctx.companyId, id, {
      name: input.name?.trim(),
      status: input.status,
      address: input.address,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      customFields: input.customFields,
      lastActivityAt: new Date(),
    });

    await this.repo.createActivity(ctx.companyId, id, {
      type: "CAMPAIGN_UPDATED",
      summary: "Campaign details updated",
      actorId: ctx.userId,
    });

    return this.getById(ctx, id);
  }

  async updateAi(
    ctx: TenantContext,
    id: string,
    input: {
      aiEnabled?: boolean;
      systemPrompt?: string | null;
      aiConfig?: Prisma.InputJsonValue;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Campaign not found");
    campaignAccessService.assertCampaignAccess(ctx, id);

    await this.repo.update(ctx.companyId, id, {
      aiEnabled: input.aiEnabled,
      systemPrompt: input.systemPrompt,
      aiConfig: input.aiConfig,
      lastActivityAt: new Date(),
    });

    await this.repo.createActivity(ctx.companyId, id, {
      type: "AI_CONFIG_UPDATED",
      summary:
        typeof input.aiEnabled === "boolean"
          ? `AI agent ${input.aiEnabled ? "enabled" : "disabled"}`
          : "AI configuration updated",
      actorId: ctx.userId,
    });

    return this.getById(ctx, id);
  }

  async archive(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Campaign not found");
    campaignAccessService.assertCampaignAccess(ctx, id);

    await this.repo.update(ctx.companyId, id, {
      status: "ARCHIVED",
      lastActivityAt: new Date(),
    });

    await this.repo.createActivity(ctx.companyId, id, {
      type: "CAMPAIGN_ARCHIVED",
      summary: "Campaign archived",
      actorId: ctx.userId,
    });

    return this.getById(ctx, id);
  }

  async delete(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Campaign not found");
    campaignAccessService.assertCampaignAccess(ctx, id);

    const deleted = await this.repo.deleteByIds(ctx.companyId, [id]);
    if (deleted === 0) {
      throw new NotFoundError("Campaign not found");
    }
    return true;
  }

  async bulkDelete(ctx: TenantContext, idsInput: string[]) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_BULK);

    const ids = [...new Set(idsInput)].filter(Boolean);
    if (ids.length === 0) throw new ValidationError("No campaigns selected");
    campaignAccessService.assertCampaignIdsAccess(ctx, ids);

    const deleted = await this.repo.deleteByIds(ctx.companyId, ids);
    return { deleted };
  }

  async bulkUpdate(
    ctx: TenantContext,
    input: {
      ids: string[];
      action: "ENABLE_AI" | "DISABLE_AI" | "UPDATE_PROMPT" | "CHANGE_STATUS" | "ARCHIVE";
      systemPrompt?: string | null;
      status?: CampaignStatus;
    },
  ) {
    // Bulk operations are restricted to company owners.
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_BULK);

    const ids = [...new Set(input.ids)].filter(Boolean);
    if (ids.length === 0) throw new ValidationError("No campaigns selected");
    campaignAccessService.assertCampaignIdsAccess(ctx, ids);

    let data: Prisma.CampaignUpdateManyMutationInput;
    let summary: string;

    switch (input.action) {
      case "ENABLE_AI":
        data = { aiEnabled: true };
        summary = "AI agent enabled (bulk)";
        break;
      case "DISABLE_AI":
        data = { aiEnabled: false };
        summary = "AI agent disabled (bulk)";
        break;
      case "UPDATE_PROMPT":
        if (input.systemPrompt == null) {
          throw new ValidationError("systemPrompt is required for UPDATE_PROMPT");
        }
        data = { systemPrompt: input.systemPrompt };
        summary = "AI system prompt updated (bulk)";
        break;
      case "CHANGE_STATUS":
        if (!input.status) {
          throw new ValidationError("status is required for CHANGE_STATUS");
        }
        data = { status: input.status };
        summary = `Status changed to ${input.status} (bulk)`;
        break;
      case "ARCHIVE":
        data = { status: "ARCHIVED" };
        summary = "Campaign archived (bulk)";
        break;
      default:
        throw new ValidationError("Unknown bulk action");
    }

    data.lastActivityAt = new Date();

    const updated = await this.repo.bulkUpdate(ctx.companyId, ids, data);
    await this.repo.createActivitiesForMany(ctx.companyId, ids, {
      type: "BULK_UPDATE",
      summary,
      actorId: ctx.userId,
    });

    return { updated };
  }

  async getContacts(
    ctx: TenantContext,
    campaignId: string,
    first?: number,
    after?: string,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    campaignAccessService.assertCampaignAccess(ctx, campaignId);
    const limit = Math.min(Math.max(first ?? 25, 1), 100);
    const rows = await this.repo.findContacts(ctx.companyId, campaignId, limit, after);
    return rows.map((row) => ({
      id: row.id,
      phone: row.phone,
      field1: row.field1,
      field2: row.field2,
      field3: row.field3,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getCallLogs(
    ctx: TenantContext,
    campaignId: string,
    first?: number,
    after?: string,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    campaignAccessService.assertCampaignAccess(ctx, campaignId);
    const limit = Math.min(Math.max(first ?? 25, 1), 100);
    const rows = await this.repo.findCallLogs(ctx.companyId, campaignId, limit, after);
    return rows.map((row) => ({
      id: row.id,
      publicId: row.publicId ?? null,
      direction: row.direction,
      status: row.status,
      durationSeconds: row.durationSeconds,
      startedAt: row.startedAt.toISOString(),
      answeredAt: row.answeredAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      leadPhone: row.lead?.phone ?? row.phoneNumber?.number ?? null,
      phoneNumber: row.phoneNumber?.number ?? row.lead?.phone ?? null,
      leadName:
        [row.lead?.firstName, row.lead?.lastName].filter(Boolean).join(" ") ||
        null,
      providerStatus: row.providerStatus ?? null,
      disconnectReason: row.disconnectReason ?? null,
    }));
  }

  async getDocuments(ctx: TenantContext, campaignId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    campaignAccessService.assertCampaignAccess(ctx, campaignId);
    const rows = await this.repo.findDocuments(ctx.companyId, campaignId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getAgents(ctx: TenantContext, campaignId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    campaignAccessService.assertCampaignAccess(ctx, campaignId);
    const rows = await this.repo.findAgents(ctx.companyId, campaignId);
    return rows.map((row) => mapAgent(row));
  }

  async getActivities(ctx: TenantContext, campaignId: string, limit?: number) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_READ);
    campaignAccessService.assertCampaignAccess(ctx, campaignId);
    const take = Math.min(Math.max(limit ?? 50, 1), 200);
    const rows = await this.repo.findActivities(ctx.companyId, campaignId, take);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      summary: row.summary,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async resendInvitation(ctx: TenantContext, campaignId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.repo.findById(ctx.companyId, campaignId);
    if (!campaign) throw new NotFoundError("Campaign not found");

    const invitation = await prisma.campaignInvitation.findUnique({
      where: { campaignId },
    });
    if (!invitation) throw new ValidationError("No invitation exists for this campaign.");

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
    });
    if (!company) throw new NotFoundError("Company not found");
    const clerkOrganizationId = await clerkOrgLib.getActiveClerkOrganizationId(company, {
      createdByClerkUserId: ctx.clerkUserId,
    });

    // Revoke old Clerk invitation
    if (invitation.clerkInvitationId && clerkOrganizationId.startsWith("org_")) {
      await clerkOrgLib.revokeClerkOrganizationInvitation({
        organizationId: clerkOrganizationId,
        invitationId: invitation.clerkInvitationId,
        requestingUserId: ctx.clerkUserId,
      });
    }

    // Rotate the token so the old link is invalidated and the new email points
    // directly at /invitations/campaign/{newToken}.
    const newToken = randomUUID();

    const clerkInvite = await clerkOrgLib.sendClerkOrganizationInvitation({
      organizationId: clerkOrganizationId,
      email: invitation.email,
      role: "ADMIN",
      inviterUserId: ctx.clerkUserId,
      redirectUrl: getCampaignInviteRedirectUrl(newToken),
      metadata: {
        propnexRole: "ADMIN",
        campaignAccessType: "SELECTED",
        campaignIds: [campaignId],
        jobTitle: "Campaign Admin",
        inviteName: campaign.name,
      },
    });

    await prisma.campaignInvitation.update({
      where: { id: invitation.id },
      data: {
        token: newToken,
        sentAt: new Date(),
        expiresAt: clerkInvite.expiresAt,
        status: "PENDING",
        acceptedAt: null,
        clerkInvitationId: clerkInvite.invitationId,
        clerkOrganizationId,
      },
    });

    const reloaded = await this.repo.findById(ctx.companyId, campaignId);
    if (!reloaded) throw new NotFoundError("Campaign not found");
    return mapBranch(reloaded, undefined, true);
  }

  async cancelInvitation(ctx: TenantContext, campaignId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const invitation = await prisma.campaignInvitation.findUnique({
      where: { campaignId },
    });
    if (!invitation) throw new ValidationError("No invitation exists for this campaign.");

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
    });
    if (!company) throw new NotFoundError("Company not found");
    const clerkOrganizationId = await clerkOrgLib.getActiveClerkOrganizationId(company, {
      createdByClerkUserId: ctx.clerkUserId,
    });

    // Revoke Clerk invitation
    if (invitation.clerkInvitationId && clerkOrganizationId.startsWith("org_")) {
      await clerkOrgLib.revokeClerkOrganizationInvitation({
        organizationId: clerkOrganizationId,
        invitationId: invitation.clerkInvitationId,
        requestingUserId: ctx.clerkUserId,
      });
    }

    await prisma.campaignInvitation.update({
      where: { id: invitation.id },
      data: { status: "CANCELLED" },
    });

    const reloaded = await this.repo.findById(ctx.companyId, campaignId);
    if (!reloaded) throw new NotFoundError("Campaign not found");
    return mapBranch(reloaded);
  }

  async generateNewInvitation(ctx: TenantContext, campaignId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.CAMPAIGNS_WRITE);
    const campaign = await this.repo.findById(ctx.companyId, campaignId);
    if (!campaign) throw new NotFoundError("Campaign not found");
    if (!campaign.email) throw new ValidationError("Campaign has no email address configured.");

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
    });
    if (!company) throw new NotFoundError("Company not found");
    const clerkOrganizationId = await clerkOrgLib.getActiveClerkOrganizationId(company, {
      createdByClerkUserId: ctx.clerkUserId,
    });

    const oldInvitation = await prisma.campaignInvitation.findUnique({
      where: { campaignId },
    });

    // Revoke old Clerk invitation
    if (oldInvitation?.clerkInvitationId && clerkOrganizationId.startsWith("org_")) {
      await clerkOrgLib.revokeClerkOrganizationInvitation({
        organizationId: clerkOrganizationId,
        invitationId: oldInvitation.clerkInvitationId,
        requestingUserId: ctx.clerkUserId,
      });
    }

    // Generate token before sending so the Clerk email redirect URL is already
    // correct when the invited user clicks it.
    const token = randomUUID();

    const clerkInvite = await clerkOrgLib.sendClerkOrganizationInvitation({
      organizationId: clerkOrganizationId,
      email: campaign.email.trim().toLowerCase(),
      role: "ADMIN",
      inviterUserId: ctx.clerkUserId,
      redirectUrl: getCampaignInviteRedirectUrl(token),
      metadata: {
        propnexRole: "ADMIN",
        campaignAccessType: "SELECTED",
        campaignIds: [campaignId],
        jobTitle: "Campaign Admin",
        inviteName: campaign.name,
      },
    });

    const expiresAt = clerkInvite.expiresAt;

    await prisma.campaignInvitation.upsert({
      where: { campaignId },
      create: {
        companyId: ctx.companyId,
        campaignId,
        email: campaign.email.trim().toLowerCase(),
        token,
        status: "PENDING",
        expiresAt,
        clerkInvitationId: clerkInvite.invitationId,
        clerkOrganizationId,
      },
      update: {
        email: campaign.email.trim().toLowerCase(),
        token,
        status: "PENDING",
        expiresAt,
        sentAt: new Date(),
        acceptedAt: null,
        clerkInvitationId: clerkInvite.invitationId,
        clerkOrganizationId,
      },
    });

    const reloaded = await this.repo.findById(ctx.companyId, campaignId);
    if (!reloaded) throw new NotFoundError("Campaign not found");
    return mapBranch(reloaded, undefined, true);
  }
}

export const campaignsService = new CampaignsService();
