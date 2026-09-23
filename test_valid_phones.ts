
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const failedCalls = await prisma.callLog.findMany({
    where: { companyId: '6a8bed4d3f5b7c2eea48418e', direction: 'OUTBOUND', OR: [{status: 'FAILED'}, {status: 'MISSED'}], NOT: { correlationId: { startsWith: 'reactivation-' } } },
    include: { lead: true }
  });
  
  let valid = 0, invalid = 0;
  for (const call of failedCalls) {
      const p = call.lead?.phone || '';
      const isVal = /^\+?[1-9]\d{1,14}$/.test(p);
      if (isVal) valid++;
      else invalid++;
  }
  console.log('Valid:', valid, 'Invalid:', invalid);
}
run();

