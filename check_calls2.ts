
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const calls = await prisma.callLog.findMany({
    where: {
      correlationId: { endsWith: '-q2' }
    },
    orderBy: { createdAt: 'asc' }
  });
  console.log('Total Q2 Calls:', calls.length);
  const leadIds = calls.map(c => c.leadId);
  const uniqueLeadIds = new Set(leadIds);
  console.log('Unique Lead IDs:', uniqueLeadIds.size);
}
run();

