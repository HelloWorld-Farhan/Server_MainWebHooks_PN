
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const calls = await prisma.callLog.findMany({
    where: {
      status: { in: ['RINGING', 'PENDING', 'QUEUED'] },
      correlationId: { startsWith: 'reactivation-' }
    },
    take: 50
  });
  console.log('Pending/Ringing Reactivation Calls:', calls.length);
  for (const c of calls) {
    console.log(c.id, c.status, c.correlationId, c.createdAt);
  }
}
run();

