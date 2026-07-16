import type { CreditUsageReason } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { decodeIdCursor } from "@/server/lib/pagination";

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

      await tx.creditBalance.upsert({
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

      return usage;
    });
  }
}
