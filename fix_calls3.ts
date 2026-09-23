
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
    select: { id: true, companyId: true, correlationId: true }
  });
  console.log(completedLogs);
}
run();

