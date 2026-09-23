
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const calls = await prisma.callLog.findMany({
    where: { correlationId: { endsWith: '-q2' } },
    select: { companyId: true }
  });
  const companies = new Set(calls.map(c => c.companyId));
  console.log('Companies:', Array.from(companies));
}
run();

