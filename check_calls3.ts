
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const calls = await prisma.callLog.findMany({
    where: { correlationId: { endsWith: '-q2' } },
    select: { leadId: true, correlationId: true, createdAt: true }
  });
  console.log('Q2 calls examples:', calls.slice(-5));
}
run();

