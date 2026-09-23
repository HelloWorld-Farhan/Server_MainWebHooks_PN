
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const istFmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  const call = await prisma.callLog.findFirst({
      where: {
        companyId: companyId,
        lead: { phone: '+919971839694' },
        correlationId: null
      },
      orderBy: { startedAt: 'desc' }
    });

    console.log('Original Failed Call for +919971839694:', call?.startedAt);
    if (call?.startedAt) {
      console.log('IST Format:', istFmt.format(call.startedAt));
    }
}
run();

