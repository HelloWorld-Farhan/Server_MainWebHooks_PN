
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const failedCalls = await prisma.callLog.findMany({
    where: { companyId: '6a8bed4d3f5b7c2eea48418e', direction: 'OUTBOUND', OR: [{status: 'FAILED'}, {status: 'MISSED'}], NOT: { correlationId: { startsWith: 'reactivation-' } } },
    include: { lead: true }
  });
  const phones = failedCalls.map(c => c.lead?.phone).filter(Boolean);
  const uniquePhones = new Set(phones);
  console.log('Total failed calls:', phones.length);
  console.log('Unique phones:', uniquePhones.size);
}
run();

