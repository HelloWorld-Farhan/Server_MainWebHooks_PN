import type { CampaignAccessType, Prisma } from "@prisma/client";

import { ForbiddenError } from "@/server/lib/errors";
import type { CampaignAccessContext, TenantContext } from "@/server/types/context";

export function buildCampaignAccessFromMember(data: {
  campaignAccessType: CampaignAccessType;
  campaignAccess?: { campaignId: string }[];
  role: TenantContext["role"];
}): CampaignAccessContext {
  if (data.role === "OWNER" || data.campaignAccessType === "ALL") {
    return { type: "ALL", campaignIds: [] };
  }

  return {
    type: "SELECTED",
    campaignIds: data.campaignAccess?.map((row) => row.campaignId) ?? [],
  };
}

export class CampaignAccessService {
  hasAllCampaignAccess(ctx: TenantContext): boolean {
    return ctx.role === "OWNER" || ctx.campaignAccess.type === "ALL";
  }

  assertCampaignAccess(ctx: TenantContext, campaignId: string) {
    if (this.hasAllCampaignAccess(ctx)) return;
    if (!ctx.campaignAccess.campaignIds.includes(campaignId)) {
      throw new ForbiddenError("You do not have access to this campaign");
    }
  }

  assertCampaignIdsAccess(ctx: TenantContext, campaignIds: string[]) {
    if (this.hasAllCampaignAccess(ctx)) return;
    const allowed = new Set(ctx.campaignAccess.campaignIds);
    const denied = campaignIds.filter((id) => !allowed.has(id));
    if (denied.length > 0) {
      throw new ForbiddenError("You do not have access to one or more campaigns");
    }
  }

  /** Filter campaigns by id when access is SELECTED. */
  campaignIdScopeFilter(ctx: TenantContext): Prisma.CampaignWhereInput {
    if (this.hasAllCampaignAccess(ctx)) return {};
    return { id: { in: ctx.campaignAccess.campaignIds } };
  }

  /** Filter leads/calls by campaignId when access is SELECTED (excludes null campaignId). */
  campaignRelationFilter(ctx: TenantContext): Prisma.LeadWhereInput {
    if (this.hasAllCampaignAccess(ctx)) return {};
    return { campaignId: { in: ctx.campaignAccess.campaignIds } };
  }

  callLogCampaignFilter(ctx: TenantContext): Prisma.CallLogWhereInput {
    if (this.hasAllCampaignAccess(ctx)) return {};
    return { campaignId: { in: ctx.campaignAccess.campaignIds } };
  }

  /** Filter employees visible to campaign-scoped viewers. */
  employeeScopeFilter(ctx: TenantContext): Prisma.CompanyMemberWhereInput {
    if (this.hasAllCampaignAccess(ctx)) return {};
    const campaignIds = ctx.campaignAccess.campaignIds;
    if (campaignIds.length === 0) {
      return { id: { in: [] } };
    }
    return {
      OR: [
        { campaignAccessType: "ALL" },
        {
          campaignAccess: {
            some: { campaignId: { in: campaignIds } },
          },
        },
      ],
    };
  }

  assertEmployeeVisible(
    ctx: TenantContext,
    employee: {
      campaignAccessType: CampaignAccessType;
      campaignAccess?: { campaignId: string }[];
    },
  ) {
    if (this.hasAllCampaignAccess(ctx)) return;
    if (employee.campaignAccessType === "ALL") return;
    const visibleIds = new Set(ctx.campaignAccess.campaignIds);
    const hasOverlap = employee.campaignAccess?.some((row) =>
      visibleIds.has(row.campaignId),
    );
    if (!hasOverlap) {
      throw new ForbiddenError("You do not have access to this employee");
    }
  }

  mergeEmployeeWhere(
    ctx: TenantContext,
    where: Prisma.CompanyMemberWhereInput,
  ): Prisma.CompanyMemberWhereInput {
    const scope = this.employeeScopeFilter(ctx);
    if (Object.keys(scope).length === 0) return where;
    return { AND: [where, scope] };
  }

  mergeLeadWhere(
    ctx: TenantContext,
    where: Prisma.LeadWhereInput,
  ): Prisma.LeadWhereInput {
    const campaignFilter = this.campaignRelationFilter(ctx);
    if (Object.keys(campaignFilter).length === 0) return where;
    return { AND: [where, campaignFilter] };
  }

  mergeCallLogWhere(
    ctx: TenantContext,
    where: Prisma.CallLogWhereInput,
  ): Prisma.CallLogWhereInput {
    const campaignFilter = this.callLogCampaignFilter(ctx);
    if (Object.keys(campaignFilter).length === 0) return where;
    return { AND: [where, campaignFilter] };
  }

  mergeCampaignWhere(
    ctx: TenantContext,
    where: Prisma.CampaignWhereInput,
  ): Prisma.CampaignWhereInput {
    const campaignFilter = this.campaignIdScopeFilter(ctx);
    if (Object.keys(campaignFilter).length === 0) return where;
    return { AND: [where, campaignFilter] };
  }

  assertLeadCampaignAccess(ctx: TenantContext, campaignId: string | null | undefined) {
    if (!campaignId) {
      if (!this.hasAllCampaignAccess(ctx)) {
        throw new ForbiddenError("You do not have access to this record");
      }
      return;
    }
    this.assertCampaignAccess(ctx, campaignId);
  }

  assertCallLogCampaignAccess(
    ctx: TenantContext,
    campaignId: string | null | undefined,
  ) {
    this.assertLeadCampaignAccess(ctx, campaignId);
  }
}

export const campaignAccessService = new CampaignAccessService();
