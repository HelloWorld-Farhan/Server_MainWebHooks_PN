import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const calls = await prisma.callLog.findMany({
    include: { phoneNumber: true, lead: true },
    where: { startedAt: { gte: new Date('2026-08-20') } },
    orderBy: { startedAt: 'desc' }
  });
  console.log("August calls:", calls.length);
  console.log(JSON.stringify(calls.map(c => ({
    id: c.id,
    startedAt: c.startedAt,
    companyId: c.companyId,
    callLogId: c.callLogId,
    number: c.phoneNumber?.number,
    providerWebhook: (typeof c.providerWebhook === 'string' ? c.providerWebhook.substring(0,50) : JSON.stringify(c.providerWebhook)?.substring(0,50))
  })), null, 2));
}

main().finally(() => prisma.$disconnect());
