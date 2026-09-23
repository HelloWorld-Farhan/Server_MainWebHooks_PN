
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
            gte: new Date('2026-09-18T18:30:00Z'), 
            lt: new Date('2026-09-19T18:30:00Z')   
        }
      },
      select: {
        id: true,
        lead: { select: { phone: true, id: true } }
      }
    });

    console.log('19 Sept IST failed phones:');
    const phones = failedCalls.map(c => c.lead?.phone);
    console.log(phones.filter(p => p && p.includes('7042598219')));
    console.log(phones.filter(p => p && p.includes('9971839694')));
    console.log(phones.filter(p => p && p.includes('9368747347')));
    console.log(phones.filter(p => p && p.includes('8668926386')));
    console.log(phones.filter(p => p && p.includes('8368972237')));
}
run();

