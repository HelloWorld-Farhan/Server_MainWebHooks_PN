
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const calls = await prisma.callLog.findMany({
    where: { companyId: '6a8bed4d3f5b7c2eea48418e', direction: 'OUTBOUND' },
    select: { correlationId: true, status: true, startedAt: true }
  });
  console.log('Total outbound calls:', calls.length);
  const q2Calls = calls.filter(c => c.correlationId?.endsWith('-q2'));
  console.log('Q2 calls:', q2Calls.length);
  
  const today = new Date();
  today.setHours(0,0,0,0);
  const todayCalls = calls.filter(c => c.startedAt && c.startedAt >= today);
  
  const counts = todayCalls.reduce((acc, c) => {
    const k = c.correlationId || 'none';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log('Today calls by correlationId:', counts);
}
run();

