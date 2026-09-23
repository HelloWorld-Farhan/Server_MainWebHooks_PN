
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const calls = await prisma.callLog.findMany({
    where: { 
      correlationId: { endsWith: '-q2' },
      companyId: '6a8bed4d3f5b7c2eea48418e'
    },
    orderBy: { createdAt: 'asc' }
  });
  console.log('Total Q2 Calls for company:', calls.length);
}
run();

