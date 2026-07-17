import {
  buildConnection,
  encodeIdCursor,
} from "@/server/lib/pagination";
import prisma from "@/server/lib/prisma";
import { BillingRepository } from "@/server/repositories/billing.repository";
import { BillingQuoteRepository } from "@/server/repositories/billing-quote.repository";
import { SetupConfigRepository } from "@/server/repositories/setup-config.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { creditsService } from "@/server/services/credits.service";

const GST_RATE = 0.18;
const MIN_CHANNEL_QTY = 3;
const CHANNEL_COST = 650;
const VIRTUAL_NUMBER_COST = 370;

function getCallTierRate(monthlyCalls: number): number {
  if (monthlyCalls >= 5001) return 3;
  if (monthlyCalls >= 1000) return 4;
  return 0;
}

function mapQuote(quote: {
  id: string;
  status: string;
  channelQty: number;
  virtualNumberQty: number;
  expectedMonthlyCalls: number;
  channelCost: number;
  virtualNumberCost: number;
  callCost: number;
  subtotal: number;
  gst: number;
  grandTotal: number;
  currency: string;
  expiresAt: Date | null;
  purchasedAt: Date | null;
  invoiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: quote.id,
    status: quote.status,
    channelQty: quote.channelQty,
    virtualNumberQty: quote.virtualNumberQty,
    expectedMonthlyCalls: quote.expectedMonthlyCalls,
    pricing: {
      channelCost: quote.channelCost,
      virtualNumberCost: quote.virtualNumberCost,
      callCost: quote.callCost,
      subtotal: quote.subtotal,
      gst: quote.gst,
      grandTotal: quote.grandTotal,
      currency: quote.currency,
    },
    expiresAt: quote.expiresAt?.toISOString() ?? null,
    purchasedAt: quote.purchasedAt?.toISOString() ?? null,
    invoiceId: quote.invoiceId,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
  };
}

export class BillingService {
  private readonly repo = new BillingRepository(prisma);
  private readonly quoteRepo = new BillingQuoteRepository(prisma);
  private readonly setupRepo = new SetupConfigRepository(prisma);

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

  async getRates(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.BILLING_READ);

    const rates = await this.setupRepo.getBillingRates(ctx.companyId);
    return {
      costPerChannel: rates?.costPerChannel ?? CHANNEL_COST,
      costPerCredit: rates?.costPerCredit ?? 0.31,
      pulseTimeSeconds: rates?.pulseTimeSeconds ?? 60,
      setupOneTimeCost: rates?.setupOneTimeCost ?? 0,
      currency: rates?.currency ?? "INR",
      minChannelPurchase: MIN_CHANNEL_QTY,
      virtualNumberCost: VIRTUAL_NUMBER_COST,
      gstRate: GST_RATE,
    };
  }

  async createQuote(
    ctx: TenantContext,
    input: {
      channelQty: number;
      virtualNumberQty: number;
      expectedMonthlyCalls: number;
    },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.BILLING_WRITE);

    if (input.channelQty > 0 && input.channelQty < MIN_CHANNEL_QTY) {
      throw new ValidationError(
        `Minimum channel purchase is ${MIN_CHANNEL_QTY}.`,
      );
    }

    const rates = await this.getRates(ctx);
    const channelCost = input.channelQty * rates.costPerChannel;
    const virtualNumberCost = input.virtualNumberQty * VIRTUAL_NUMBER_COST;
    const callCost =
      input.expectedMonthlyCalls * getCallTierRate(input.expectedMonthlyCalls);
    const subtotal = channelCost + virtualNumberCost + callCost;
    const gst = Math.round(subtotal * GST_RATE * 100) / 100;
    const grandTotal = Math.round((subtotal + gst) * 100) / 100;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const quote = await this.quoteRepo.create(ctx.companyId, {
      channelQty: input.channelQty,
      virtualNumberQty: input.virtualNumberQty,
      expectedMonthlyCalls: input.expectedMonthlyCalls,
      channelCost,
      virtualNumberCost,
      callCost,
      subtotal,
      gst,
      grandTotal,
      currency: rates.currency,
      expiresAt,
    });

    return mapQuote(quote);
  }

  async listQuotes(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.BILLING_READ);
    const quotes = await this.quoteRepo.findMany(ctx.companyId);
    return quotes.map(mapQuote);
  }

  async purchaseQuote(ctx: TenantContext, quoteId: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.BILLING_WRITE);

    const quote = await this.quoteRepo.findById(ctx.companyId, quoteId);
    if (!quote) {
      throw new NotFoundError("Quote not found");
    }
    if (quote.status === "PURCHASED") {
      throw new ValidationError("Quote has already been purchased.");
    }
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      await this.quoteRepo.updateStatus(ctx.companyId, quoteId, {
        status: "EXPIRED",
      });
      throw new ValidationError("Quote has expired.");
    }

    const subscription =
      (await this.repo.getSubscription(ctx.companyId)) ??
      (await prisma.billingSubscription.create({
        data: {
          companyId: ctx.companyId,
          planId: "resource-purchase",
          planName: "Resource Purchase",
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      }));

    const invoice = await prisma.billingInvoice.create({
      data: {
        companyId: ctx.companyId,
        subscriptionId: subscription.id,
        amountCents: Math.round(quote.grandTotal * 100),
        currency: quote.currency,
        status: "PAID",
        description: `Resource purchase quote ${quote.id}`,
        issuedAt: new Date(),
        paidAt: new Date(),
      },
    });

    if (quote.channelQty > 0) {
      const existing = await this.setupRepo.getSetupConfig(ctx.companyId);
      await this.setupRepo.upsertSetupConfig(ctx.companyId, {
        totalChannels: (existing?.totalChannels ?? 0) + quote.channelQty,
      });
    }

    const rates = await this.getRates(ctx);
    const creditsToAdd = Math.max(
      0,
      Math.round(quote.grandTotal / rates.costPerCredit),
    );
    if (creditsToAdd > 0) {
      await creditsService.adjustCredits(
        ctx,
        creditsToAdd,
        `Purchase from quote ${quote.id}`,
      );
    }

    await this.quoteRepo.updateStatus(ctx.companyId, quoteId, {
      status: "PURCHASED",
      purchasedAt: new Date(),
      invoiceId: invoice.id,
    });

    const updated = await this.quoteRepo.findById(ctx.companyId, quoteId);
    return {
      quote: mapQuote(updated!),
      invoice: {
        id: invoice.id,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        status: invoice.status,
        issuedAt: invoice.issuedAt.toISOString(),
      },
    };
  }
}

export const billingService = new BillingService();
