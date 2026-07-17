import { BaseRepository } from "@/server/repositories/base.repository";

export class SetupConfigRepository extends BaseRepository {
  getSetupConfig(companyId: string) {
    return this.prisma.companySetupConfig.findUnique({
      where: { companyId },
    });
  }

  upsertSetupConfig(
    companyId: string,
    data: {
      totalChannels: number;
      pulseTimeSeconds?: number;
      deltaSeconds?: number;
      agentsAllocated?: number;
    },
  ) {
    return this.prisma.companySetupConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        totalChannels: data.totalChannels,
        pulseTimeSeconds: data.pulseTimeSeconds ?? 60,
        deltaSeconds: data.deltaSeconds ?? 2,
        agentsAllocated: data.agentsAllocated ?? 0,
      },
      update: {
        totalChannels: data.totalChannels,
        ...(data.pulseTimeSeconds !== undefined
          ? { pulseTimeSeconds: data.pulseTimeSeconds }
          : {}),
        ...(data.deltaSeconds !== undefined
          ? { deltaSeconds: data.deltaSeconds }
          : {}),
        ...(data.agentsAllocated !== undefined
          ? { agentsAllocated: data.agentsAllocated }
          : {}),
      },
    });
  }

  listChannels(companyId: string) {
    return this.prisma.companyChannel.findMany({
      where: { companyId },
      orderBy: { channelIndex: "asc" },
      include: {
        phoneNumber: { select: { id: true, number: true, label: true } },
      },
    });
  }

  replaceChannels(
    companyId: string,
    channels: { channelIndex: number; label?: string; phoneNumberId?: string }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.companyChannel.deleteMany({ where: { companyId } });
      if (channels.length === 0) return [];

      await tx.companyChannel.createMany({
        data: channels.map((channel) => ({
          companyId,
          channelIndex: channel.channelIndex,
          label: channel.label ?? null,
          phoneNumberId: channel.phoneNumberId ?? null,
        })),
      });

      return tx.companyChannel.findMany({
        where: { companyId },
        orderBy: { channelIndex: "asc" },
        include: {
          phoneNumber: { select: { id: true, number: true, label: true } },
        },
      });
    });
  }

  getBillingRates(companyId: string) {
    return this.prisma.companyBillingRates.findUnique({
      where: { companyId },
    });
  }

  upsertBillingRates(
    companyId: string,
    data: {
      costPerChannel?: number;
      costPerCredit?: number;
      pulseTimeSeconds?: number;
      setupOneTimeCost?: number;
      currency?: string;
    },
  ) {
    return this.prisma.companyBillingRates.upsert({
      where: { companyId },
      create: {
        companyId,
        costPerChannel: data.costPerChannel ?? 650,
        costPerCredit: data.costPerCredit ?? 0.31,
        pulseTimeSeconds: data.pulseTimeSeconds ?? 60,
        setupOneTimeCost: data.setupOneTimeCost ?? 0,
        currency: data.currency ?? "INR",
      },
      update: data,
    });
  }
}
