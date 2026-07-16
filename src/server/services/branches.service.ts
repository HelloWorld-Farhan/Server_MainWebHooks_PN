import { randomUUID } from "crypto";
import type { BranchStatus, Prisma } from "@prisma/client";

import { NotFoundError, ValidationError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import {
  BranchesRepository,
  type BranchFilter,
} from "@/server/repositories/branches.repository";
import { buildConnection, encodeIdCursor } from "@/server/lib/pagination";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { branchAccessService } from "@/server/services/branch-access.service";
import { tenantService } from "@/server/services/tenant.service";
import { clerkOrgLib } from "@/lib/clerk/organization";
import { getBranchInviteRedirectUrl } from "@/lib/app-url";

type BranchRow = Awaited<
  ReturnType<BranchesRepository["findById"]>
>;

function mapBranch(
  row: NonNullable<BranchRow>,
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
  branchId: string | null;
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
    branchId: row.branchId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type BranchConnectionArgs = {
  first?: number;
  after?: string;
  filter?: BranchFilter;
};

export class BranchesService {
  private readonly repo = new BranchesRepository(prisma);

  async getConnection(ctx: TenantContext, args: BranchConnectionArgs) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_READ);
    const limit = Math.min(Math.max(args.first ?? 25, 1), 200);

    const scopeWhere = branchAccessService.branchIdScopeFilter(ctx);
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
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_READ);
    branchAccessService.assertBranchAccess(ctx, id);
    const row = await this.repo.findById(ctx.companyId, id);
    if (!row) throw new NotFoundError("Branch not found");
    const counts = await this.repo.countRelations(ctx.companyId, id);
    return mapBranch(row, counts);
  }

  async create(
    ctx: TenantContext,
    input: {
      name: string;
      status?: BranchStatus;
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
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_WRITE);
    const name = input.name?.trim();
    if (!name) throw new ValidationError("Branch name is required");

    const row = await this.repo.create(ctx.companyId, {
      name,
      status: input.status,
      address: input.address ?? undefined,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      notes: input.notes ?? undefined,
      customFields: input.customFields ?? {},
      aiEnabled: input.aiEnabled ?? false,
      systemPrompt: input.systemPrompt ?? undefined,
      aiConfig: input.aiConfig ?? {},
      lastActivityAt: new Date(),
    });

    await this.repo.createActivity(ctx.companyId, row.id, {
      type: "BRANCH_CREATED",
      summary: `Branch "${row.name}" created`,
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
      // URL embedded in the email already points at /invitations/branch/{token}.
      // This ensures the user lands on the acceptance page and the
      // acceptInvitation server action fires — which is the only path that
      // sets BranchInvitation.status = ACCEPTED.
      const token = randomUUID();

      const clerkInvite = await clerkOrgLib.sendClerkOrganizationInvitation({
        organizationId: clerkOrganizationId,
        email: emailVal,
        role: "ADMIN",
        inviterUserId: ctx.clerkUserId,
        redirectUrl: getBranchInviteRedirectUrl(token),
        metadata: {
          propnexRole: "ADMIN",
          branchAccessType: "SELECTED",
          branchIds: [row.id],
          jobTitle: "Branch Admin",
          inviteName: row.name,
        },
      });

      const expiresAt = clerkInvite.expiresAt;

      await prisma.branchInvitation.create({
        data: {
          companyId: ctx.companyId,
          branchId: row.id,
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
      status?: BranchStatus;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      customFields?: Prisma.InputJsonValue;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Branch not found");
    branchAccessService.assertBranchAccess(ctx, id);

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
      type: "BRANCH_UPDATED",
      summary: "Branch details updated",
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
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Branch not found");
    branchAccessService.assertBranchAccess(ctx, id);

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
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_WRITE);

    const existing = await this.repo.findById(ctx.companyId, id);
    if (!existing) throw new NotFoundError("Branch not found");
    branchAccessService.assertBranchAccess(ctx, id);

    await this.repo.update(ctx.companyId, id, {
      status: "ARCHIVED",
      lastActivityAt: new Date(),
    });

    await this.repo.createActivity(ctx.companyId, id, {
      type: "BRANCH_ARCHIVED",
      summary: "Branch archived",
      actorId: ctx.userId,
    });

    return this.getById(ctx, id);
  }

  async bulkUpdate(
    ctx: TenantContext,
    input: {
      ids: string[];
      action: "ENABLE_AI" | "DISABLE_AI" | "UPDATE_PROMPT" | "CHANGE_STATUS" | "ARCHIVE";
      systemPrompt?: string | null;
      status?: BranchStatus;
    },
  ) {
    // Bulk operations are restricted to company owners.
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_BULK);

    const ids = [...new Set(input.ids)].filter(Boolean);
    if (ids.length === 0) throw new ValidationError("No branches selected");
    branchAccessService.assertBranchIdsAccess(ctx, ids);

    let data: Prisma.BranchUpdateManyMutationInput;
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
        summary = "Branch archived (bulk)";
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
    branchId: string,
    first?: number,
    after?: string,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_READ);
    branchAccessService.assertBranchAccess(ctx, branchId);
    const limit = Math.min(Math.max(first ?? 25, 1), 100);
    const rows = await this.repo.findContacts(ctx.companyId, branchId, limit, after);
    return rows.map((row) => {
      const nameParts = row.name?.trim().split(/\s+/).filter(Boolean) ?? [];
      return {
        id: row.id,
        firstName: nameParts[0] ?? null,
        lastName: nameParts.slice(1).join(" ") || null,
        email: row.email,
        phone: row.phone,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async getCallLogs(
    ctx: TenantContext,
    branchId: string,
    first?: number,
    after?: string,
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_READ);
    branchAccessService.assertBranchAccess(ctx, branchId);
    const limit = Math.min(Math.max(first ?? 25, 1), 100);
    const rows = await this.repo.findCallLogs(ctx.companyId, branchId, limit, after);
    return rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      status: row.status,
      durationSeconds: row.durationSeconds,
      startedAt: row.startedAt.toISOString(),
      leadPhone: row.lead?.phone ?? null,
      leadName:
        [row.lead?.firstName, row.lead?.lastName].filter(Boolean).join(" ") ||
        null,
    }));
  }

  async getDocuments(ctx: TenantContext, branchId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_READ);
    branchAccessService.assertBranchAccess(ctx, branchId);
    const rows = await this.repo.findDocuments(ctx.companyId, branchId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getAgents(ctx: TenantContext, branchId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_READ);
    branchAccessService.assertBranchAccess(ctx, branchId);
    const rows = await this.repo.findAgents(ctx.companyId, branchId);
    return rows.map((row) => mapAgent(row));
  }

  async getActivities(ctx: TenantContext, branchId: string, limit?: number) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_READ);
    branchAccessService.assertBranchAccess(ctx, branchId);
    const take = Math.min(Math.max(limit ?? 50, 1), 200);
    const rows = await this.repo.findActivities(ctx.companyId, branchId, take);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      summary: row.summary,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async resendInvitation(ctx: TenantContext, branchId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_WRITE);
    const branch = await this.repo.findById(ctx.companyId, branchId);
    if (!branch) throw new NotFoundError("Branch not found");

    const invitation = await prisma.branchInvitation.findUnique({
      where: { branchId },
    });
    if (!invitation) throw new ValidationError("No invitation exists for this branch.");

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
    // directly at /invitations/branch/{newToken}.
    const newToken = randomUUID();

    const clerkInvite = await clerkOrgLib.sendClerkOrganizationInvitation({
      organizationId: clerkOrganizationId,
      email: invitation.email,
      role: "ADMIN",
      inviterUserId: ctx.clerkUserId,
      redirectUrl: getBranchInviteRedirectUrl(newToken),
      metadata: {
        propnexRole: "ADMIN",
        branchAccessType: "SELECTED",
        branchIds: [branchId],
        jobTitle: "Branch Admin",
        inviteName: branch.name,
      },
    });

    await prisma.branchInvitation.update({
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

    const reloaded = await this.repo.findById(ctx.companyId, branchId);
    if (!reloaded) throw new NotFoundError("Branch not found");
    return mapBranch(reloaded, undefined, true);
  }

  async cancelInvitation(ctx: TenantContext, branchId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_WRITE);
    const invitation = await prisma.branchInvitation.findUnique({
      where: { branchId },
    });
    if (!invitation) throw new ValidationError("No invitation exists for this branch.");

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

    await prisma.branchInvitation.update({
      where: { id: invitation.id },
      data: { status: "CANCELLED" },
    });

    const reloaded = await this.repo.findById(ctx.companyId, branchId);
    if (!reloaded) throw new NotFoundError("Branch not found");
    return mapBranch(reloaded);
  }

  async generateNewInvitation(ctx: TenantContext, branchId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.BRANCHES_WRITE);
    const branch = await this.repo.findById(ctx.companyId, branchId);
    if (!branch) throw new NotFoundError("Branch not found");
    if (!branch.email) throw new ValidationError("Branch has no email address configured.");

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
    });
    if (!company) throw new NotFoundError("Company not found");
    const clerkOrganizationId = await clerkOrgLib.getActiveClerkOrganizationId(company, {
      createdByClerkUserId: ctx.clerkUserId,
    });

    const oldInvitation = await prisma.branchInvitation.findUnique({
      where: { branchId },
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
      email: branch.email.trim().toLowerCase(),
      role: "ADMIN",
      inviterUserId: ctx.clerkUserId,
      redirectUrl: getBranchInviteRedirectUrl(token),
      metadata: {
        propnexRole: "ADMIN",
        branchAccessType: "SELECTED",
        branchIds: [branchId],
        jobTitle: "Branch Admin",
        inviteName: branch.name,
      },
    });

    const expiresAt = clerkInvite.expiresAt;

    await prisma.branchInvitation.upsert({
      where: { branchId },
      create: {
        companyId: ctx.companyId,
        branchId,
        email: branch.email.trim().toLowerCase(),
        token,
        status: "PENDING",
        expiresAt,
        clerkInvitationId: clerkInvite.invitationId,
        clerkOrganizationId,
      },
      update: {
        email: branch.email.trim().toLowerCase(),
        token,
        status: "PENDING",
        expiresAt,
        sentAt: new Date(),
        acceptedAt: null,
        clerkInvitationId: clerkInvite.invitationId,
        clerkOrganizationId,
      },
    });

    const reloaded = await this.repo.findById(ctx.companyId, branchId);
    if (!reloaded) throw new NotFoundError("Branch not found");
    return mapBranch(reloaded, undefined, true);
  }
}

export const branchesService = new BranchesService();
