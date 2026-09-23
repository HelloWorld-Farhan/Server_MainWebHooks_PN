
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const today = new Date('2026-09-20T00:00:00+05:30');
  
  const completedLogs = await prisma.callLog.findMany({
    where: { 
      status: 'COMPLETED',
      startedAt: { gte: today },
      direction: 'OUTBOUND'
    },
    include: { lead: true }
  });
  console.log('Found ALL completed logs today:', completedLogs.length);
  for (const log of completedLogs) {
     console.log('Log', log.id, 'Lead', log.lead?.phone, 'CorrelId:', log.correlationId);
     
     if (!log.correlationId) {
         // Let's find any pending/failed logs with correlation ID for this lead today
         const originalLog = await prisma.callLog.findFirst({
            where: {
               leadId: log.leadId,
               startedAt: { gte: today },
               correlationId: { startsWith: 'reactivation-' }
            }
         });
         if (originalLog) {
             console.log('Found correlationId', originalLog.correlationId, 'for lead', log.lead?.phone);
             await prisma.callLog.update({
                where: { id: log.id },
                data: { correlationId: originalLog.correlationId }
             });
             console.log('Fixed');
         }
     }
  }
}
run();

