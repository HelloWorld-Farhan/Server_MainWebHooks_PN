import type { Prisma, PrismaClient, SupportRequestReason } from "@prisma/client";

export type CreateSupportRequestInput = {
  name: string;
  email: string;
  reason: SupportRequestReason;
  planId: string | null;
  planName: string | null;
  message: string;
  userId?: string | null;
  companyId?: string | null;
  clerkUserId?: string | null;
};

export class SupportRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreateSupportRequestInput) {
    return this.prisma.supportRequest.create({
      data: {
        name: data.name,
        email: data.email,
        reason: data.reason,
        planId: data.planId,
        planName: data.planName,
        message: data.message,
        userId: data.userId ?? null,
        companyId: data.companyId ?? null,
        clerkUserId: data.clerkUserId ?? null,
      },
    });
  }

  findById(id: string) {
    return this.prisma.supportRequest.findUnique({ where: { id } });
  }
}

export type SupportRequestRecord = Prisma.SupportRequestGetPayload<{
  include: { company: { select: { name: true } } };
}>;
