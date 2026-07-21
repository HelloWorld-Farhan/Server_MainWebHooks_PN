import DataLoader from "dataloader";

import prisma from "@/server/lib/prisma";
import { AgentsRepository } from "@/server/repositories/agents.repository";
import { CampaignsRepository } from "@/server/repositories/campaigns.repository";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { PhoneNumbersRepository } from "@/server/repositories/phone-numbers.repository";
import { TenantRepository } from "@/server/repositories/tenant.repository";

export function createDataLoaders(companyId: string) {
  const leadsRepo = new CallLogsRepository(prisma);
  const agentsRepo = new AgentsRepository(prisma);
  const phoneNumbersRepo = new PhoneNumbersRepository(prisma);
  const tenantRepo = new TenantRepository(prisma);
  const campaignsRepo = new CampaignsRepository(prisma);

  return {
    lead: new DataLoader(async (ids: readonly string[]) => {
      const leads = await leadsRepo.findLeadsByIds(companyId, [...ids]);
      const map = new Map(leads.map((l) => [l.id, l]));
      return ids.map((id) => map.get(id) ?? null);
    }),
    aiAgent: new DataLoader(async (ids: readonly string[]) => {
      const agents = await agentsRepo.findByIds(companyId, [...ids]);
      const map = new Map(agents.map((a) => [a.id, a]));
      return ids.map((id) => map.get(id) ?? null);
    }),
    phoneNumber: new DataLoader(async (ids: readonly string[]) => {
      const numbers = await phoneNumbersRepo.findByIds(companyId, [...ids]);
      const map = new Map(numbers.map((n) => [n.id, n]));
      return ids.map((id) => map.get(id) ?? null);
    }),
    user: new DataLoader(async (ids: readonly string[]) => {
      const users = await tenantRepo.findUsersByIds(companyId, [...ids]);
      const map = new Map(users.map((u) => [u.id, u]));
      return ids.map((id) => map.get(id) ?? null);
    }),
    campaign: new DataLoader(async (ids: readonly string[]) => {
      const campaigns = await campaignsRepo.findByIds(companyId, [...ids]);
      const map = new Map(campaigns.map((b) => [b.id, b] as const));
      return ids.map((id) => map.get(id) ?? null);
    }),
  };
}
