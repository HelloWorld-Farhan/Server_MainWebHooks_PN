
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e'; // from fix_calls3.ts
  const reactivationLogs = await prisma.callLog.findMany({
      where: {
        companyId: companyId,
        direction: 'OUTBOUND',
        correlationId: { startsWith: 'reactivation-' }
      },
      select: {
        leadId: true,
        status: true,
        correlationId: true,
        durationSeconds: true,
        startedAt: true,
        lead: true
      }
    });

    console.log('Reactivation Logs length:', reactivationLogs.length);
    const successLogs = reactivationLogs.filter(l => l.status === 'COMPLETED' && l.durationSeconds! > 0);
    console.log('Successful Q1 logs:', successLogs.length);
    for (const l of successLogs) {
        console.log('Success Log:', l.correlationId, '| Lead ID:', l.leadId, '| Phone:', l.lead?.phone);
    }
}
run();

