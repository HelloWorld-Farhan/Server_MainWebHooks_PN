
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const twoMinsAgo = new Date(Date.now() - 120000);
  
  const stuckCalls = await prisma.callLog.updateMany({
    where: {
      status: { in: ['RINGING', 'PENDING', 'QUEUED'] },
      createdAt: { lt: twoMinsAgo }
    },
    data: {
      status: 'FAILED'
    }
  });
  
  console.log('Fixed stuck calls:', stuckCalls.count);
}
run();

