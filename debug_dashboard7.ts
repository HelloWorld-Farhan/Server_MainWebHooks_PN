
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  
  // get phones for 19 sept failed leads
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
        lead: { select: { phone: true } }
      }
    });

    const phones = failedCalls.map(c => c.lead?.phone).filter(Boolean);
    console.log('Total 19 Sept Failed Phones:', phones.length);
    
    // now find reactivation logs for these phones
    const reactivationLogs = await prisma.callLog.findMany({
        where: {
            companyId: companyId,
            correlationId: { startsWith: 'reactivation-2026-09-19' },
            lead: { phone: { in: phones as string[] } }
        }
    });
    console.log('Reactivation logs for 19 Sept phones today:', reactivationLogs.length);
}
run();

