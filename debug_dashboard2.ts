
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  const failedCalls = await prisma.callLog.findMany({
      where: {
        companyId: companyId,
        direction: 'OUTBOUND',
        OR: [
          { status: { in: ['FAILED', 'MISSED', 'BUSY', 'NO_ANSWER', 'CANCELLED'] } },
          { durationSeconds: 0 },
        ],
        NOT: {
          AND: [
            { correlationId: { isSet: true } },
            { correlationId: { startsWith: 'reactivation-' } }
          ]
        },
        lead: { phone: '+919971839694' }
      },
      select: {
        id: true,
        startedAt: true,
        leadId: true,
      }
    });

    console.log('Original failed calls for +919971839694:');
    for (const l of failedCalls) {
        console.log(l.id, l.startedAt, l.leadId);
    }
}
run();

