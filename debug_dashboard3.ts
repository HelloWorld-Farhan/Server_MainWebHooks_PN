
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
        startedAt: {
            gte: new Date('2026-09-18T18:30:00Z'), // Sept 19 IST 00:00
            lt: new Date('2026-09-19T18:30:00Z')   // Sept 20 IST 00:00
        }
      },
      select: {
        id: true,
        startedAt: true,
        leadId: true,
        lead: true
      }
    });

    console.log('Original failed calls for 19 Sept IST:', failedCalls.length);
    for (let i = 0; i < Math.min(10, failedCalls.length); i++) {
        const l = failedCalls[i];
        console.log(l.id, l.startedAt, l.leadId, l.lead?.phone);
    }
}
run();

