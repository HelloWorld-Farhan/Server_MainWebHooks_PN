import {
  buildConnection,
  encodeIdCursor,
} from "@/server/lib/pagination";
import prisma from "@/server/lib/prisma";
import { BillingRepository } from "@/server/repositories/billing.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";

export class BillingService {
  private readonly repo = new BillingRepository(prisma);

  async getSubscription(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.BILLING_READ);

    const subscription = await this.repo.getSubscription(ctx.companyId);
    if (!subscription) return null;

    return {
      id: subscription.id,
      planId: subscription.planId,
      planName: subscription.planName,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      nextInvoiceAmount: null as number | null,
    };
  }

  async getInvoices(
    ctx: TenantContext,
    args: { first?: number; after?: string },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.BILLING_READ);

    const limit = Math.min(args.first ?? 20, 100);
    const items = await this.repo.listInvoices(
      ctx.companyId,
      limit,
      args.after,
    );

    return buildConnection(items, limit, (item) =>
      encodeIdCursor(item.id, item.issuedAt),
    );
  }
}

export const billingService = new BillingService();
