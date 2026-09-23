
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const today = new Date('2026-09-20T00:00:00+05:30');
  
  // 1. Find the 6 COMPLETED calls today that have no correlationId
  const completedLogs = await prisma.callLog.findMany({
    where: { 
      status: 'COMPLETED',
      startedAt: { gte: today },
      correlationId: null,
      direction: 'OUTBOUND'
    },
    include: { lead: true }
  });
  console.log('Found completed logs without correlationId:', completedLogs.length);
  
  for (const log of completedLogs) {
     console.log('Fixing log', log.id, 'Lead', log.lead?.phone);
     
     // 2. Find the original PENDING/FAILED call log that DOES have the correlationId for this lead today
     const originalLog = await prisma.callLog.findFirst({
        where: {
           leadId: log.leadId,
           startedAt: { gte: today },
           correlationId: { startsWith: 'reactivation-' }
        }
     });
     
     if (originalLog) {
         console.log('Found original correlationId:', originalLog.correlationId);
         // 3. Update the completed log with the correlationId
         await prisma.callLog.update({
            where: { id: log.id },
            data: { correlationId: originalLog.correlationId }
         });
         console.log('Fixed log', log.id);
     } else {
         console.log('Could not find original correlationId for', log.id);
     }
  }
}
run();

