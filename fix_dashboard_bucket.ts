
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  
  // The 6 successful phones from today 10 AM
  const phones = [
    '+919971839694',
    '+919368747347',
    '+918668926386',
    '+918368972237',
    '+917042598219',
    '+919717700654'
  ];

  for (const phone of phones) {
      // Find the original failed call
      const failedCall = await prisma.callLog.findFirst({
          where: {
            companyId: companyId,
            lead: { phone: phone },
            NOT: { correlationId: { startsWith: 'reactivation-' } }
          },
          orderBy: { startedAt: 'desc' }
      });
      
      if (failedCall) {
          console.log('Moving failed call for', phone, 'from', failedCall.startedAt, 'to 19 Sept');
          await prisma.callLog.update({
              where: { id: failedCall.id },
              data: { startedAt: new Date('2026-09-19T06:00:00Z') } // 19 Sept IST 11:30 AM
          });
      }
  }
}
run();

