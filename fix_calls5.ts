
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const q1Logs = await prisma.callLog.findMany({
    where: { 
      correlationId: { startsWith: 'reactivation-2026-09-19' }
    },
    include: { lead: true }
  });
  
  for (const log of q1Logs) {
     const originalFailed = await prisma.callLog.findFirst({
        where: {
           startedAt: { gte: new Date('2026-09-19T00:00:00+05:30'), lte: new Date('2026-09-19T23:59:59+05:30') },
           lead: { phone: log.lead?.phone },
           correlationId: null
        }
     });
     
     console.log('Phone:', log.lead?.phone, '| Q1 Lead ID:', log.leadId, '| Original Lead ID:', originalFailed?.leadId);
     console.log('Match?', log.leadId === originalFailed?.leadId);
  }
}
run();

