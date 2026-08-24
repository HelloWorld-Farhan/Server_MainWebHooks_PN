import type { CreditUsageReason } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";
import { notificationService } from "@/server/services/notification.service";

export class CreditsRepository extends BaseRepository {
  getBalance(companyId: string) {
    return this.prisma.creditBalance.findUnique({
      where: { companyId },
    });
  }

  ensureBalance(companyId: string) {
    return this.prisma.creditBalance.upsert({
      where: { companyId },
      create: { companyId, creditsRemaining: 0, creditsUsed: 0 },
      update: {},
    });
  }

  listUsage(companyId: string, limit: number, after?: string) {
    const cursor = after ? decodeIdCursor(after) : undefined;

    return this.prisma.creditUsage.findMany({
      where: this.scope(companyId),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor.id },
            skip: 1,
          }
        : {}),
    });
  }

  async recordUsage(
    companyId: string,
    data: {
      amount: number;
      reason: CreditUsageReason;
      callLogId?: string;
      description?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const usage = await tx.creditUsage.create({
        data: {
          companyId,
          amount: data.amount,
          reason: data.reason,
          callLogId: data.callLogId,
          description: data.description,
        },
      });

      // Get current balance
      const currentBalance = await tx.creditBalance.findUnique({
        where: { companyId },
      });
      const previousRemaining = currentBalance ? currentBalance.creditsRemaining : 0;

      const newBalance = await tx.creditBalance.upsert({
        where: { companyId },
        create: {
          companyId,
          creditsRemaining: Math.max(0, -data.amount),
          creditsUsed: Math.max(0, data.amount),
        },
        update: {
          creditsRemaining: { decrement: data.amount },
          creditsUsed: { increment: Math.max(0, data.amount) },
        },
      });

      if (previousRemaining > 0 && newBalance.creditsRemaining <= 0) {
        // Balance hit zero
        // Run in background to avoid blocking transaction
        process.nextTick(async () => {
          try {
            const fullCompany = await this.prisma.company.findUnique({
              where: { id: companyId },
              include: {
                members: { where: { role: "OWNER", status: "ACTIVE" }, include: { user: true } },
              },
            });
            const user = fullCompany?.members?.[0]?.user;
            if (user && user.email) {
              if (fullCompany.parentCompanyId) {
                // It's a sub-company
                await notificationService.sendSubCompanyCreditZeroWarningEmail({
                  email: user.email,
                  companyName: fullCompany.name,
                });
              } else {
                // It's a main company
                await notificationService.sendCreditZeroWarningEmail({
                  email: user.email,
                  name: user.firstName ? `${user.firstName} ${user.lastName}`.trim() : user.email.split("@")[0],
                });
              }
            }
          } catch (err) {
            console.error("Failed to process zero credit warning:", err);
          }
        });
      }

      return usage;
    });
  }
}
