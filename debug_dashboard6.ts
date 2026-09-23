
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  const calls = await prisma.callLog.findMany({
      where: {
        lead: { phone: '+917042598219' }
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        direction: true,
        correlationId: true
      }
    });

    console.log('+917042598219 ALL calls:');
    console.log(calls);
}
run();

