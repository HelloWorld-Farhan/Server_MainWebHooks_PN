
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  const failedCall = await prisma.callLog.findFirst({
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
        startedAt: {
            gte: new Date('2026-09-18T18:30:00Z'), 
            lt: new Date('2026-09-19T18:30:00Z')   
        },
        lead: { phone: '+917042598219' }
      },
      select: {
        id: true,
        startedAt: true,
        leadId: true,
        lead: { select: { phone: true } }
      }
    });

    console.log('Original 19 Sept Failed Call for +917042598219:', failedCall);
}
run();

