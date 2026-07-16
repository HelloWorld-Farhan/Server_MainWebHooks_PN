import type { Prisma, TelephonyProvider } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";

const agentSelect = {
  id: true,
  name: true,
} as const;

export class PhoneNumbersRepository extends BaseRepository {
  findMany(companyId: string) {
    return this.prisma.phoneNumber.findMany({
      where: this.scope(companyId),
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.phoneNumber.findFirst({
      where: { id, companyId },
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
    });
  }

  findByIds(companyId: string, ids: string[]) {
    return this.prisma.phoneNumber.findMany({
      where: { companyId, id: { in: ids } },
      select: {
        id: true,
        number: true,
        label: true,
      },
    });
  }

  create(
    companyId: string,
    data: {
      number: string;
      provider: TelephonyProvider;
      label?: string;
      inboundAgentId?: string;
      outboundAgentId?: string;
    },
  ) {
    return this.prisma.phoneNumber.create({
      data: {
        number: data.number,
        provider: data.provider,
        label: data.label,
        company: { connect: { id: companyId } },
        ...(data.inboundAgentId
          ? { inboundAgent: { connect: { id: data.inboundAgentId } } }
          : {}),
        ...(data.outboundAgentId
          ? { outboundAgent: { connect: { id: data.outboundAgentId } } }
          : {}),
      },
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
    });
  }

  update(
    companyId: string,
    id: string,
    data: Prisma.PhoneNumberUpdateInput,
  ) {
    return this.prisma.phoneNumber.update({
      where: { id },
      data,
      include: {
        inboundAgent: { select: agentSelect },
        outboundAgent: { select: agentSelect },
      },
    });
  }
}
