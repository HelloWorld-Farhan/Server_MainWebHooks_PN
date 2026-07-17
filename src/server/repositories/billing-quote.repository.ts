import { BaseRepository } from "@/server/repositories/base.repository";

export class BillingQuoteRepository extends BaseRepository {
  create(
    companyId: string,
    data: {
      channelQty: number;
      virtualNumberQty: number;
      expectedMonthlyCalls: number;
      channelCost: number;
      virtualNumberCost: number;
      callCost: number;
      subtotal: number;
      gst: number;
      grandTotal: number;
      currency?: string;
      expiresAt?: Date;
    },
  ) {
    return this.prisma.billingQuote.create({
      data: {
        companyId,
        ...data,
        currency: data.currency ?? "INR",
      },
    });
  }

  findMany(companyId: string) {
    return this.prisma.billingQuote.findMany({
      where: this.scope(companyId),
      orderBy: { createdAt: "desc" },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.billingQuote.findFirst({
      where: { id, companyId },
    });
  }

  updateStatus(
    companyId: string,
    id: string,
    data: {
      status: "DRAFT" | "SENT" | "EXPIRED" | "PURCHASED";
      purchasedAt?: Date;
      invoiceId?: string;
    },
  ) {
    return this.prisma.billingQuote.updateMany({
      where: { id, companyId },
      data,
    });
  }
}
