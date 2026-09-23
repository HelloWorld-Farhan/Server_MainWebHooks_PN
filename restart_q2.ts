
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();
const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
const queue = new Queue('campaign-execution-queue', { connection: redis });

async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  const campaignId = 'reactivation-2026-09-19-6a8bed4d-350798-q2';
  
  // Find all failed Q1 calls to rebuild the leads list
  const failedCalls = await prisma.callLog.findMany({
    where: { companyId, direction: 'OUTBOUND', OR: [{status: 'FAILED'}, {status: 'MISSED'}], NOT: { correlationId: { startsWith: 'reactivation-' } } },
    include: { lead: true }
  });
  
  // Find already attempted Q2 calls
  const attemptedLogs = await prisma.callLog.findMany({
    where: { companyId, correlationId: campaignId },
    include: { lead: true }
  });
  const attemptedPhones = new Set(attemptedLogs.map(l => l.lead?.phone || (l as any).toNumber).filter(Boolean));
  
  const remainingLeads: any[] = [];
  for (const c of failedCalls) {
      if (c.lead?.phone && !attemptedPhones.has(c.lead.phone)) {
          remainingLeads.push({
              id: c.leadId || 'manual-'+c.lead.phone,
              phone: c.lead.phone,
              name: c.lead.firstName || 'Outbound',
              didNumber: '07946350798' // from screenshot
          });
      }
  }
  
  console.log('Remaining leads to call:', remainingLeads.length);
  
  if (remainingLeads.length > 0) {
      const data = {
          companyId,
          campaignId,
          isReactivation: true,
          qStage: 'Q2',
          leads: remainingLeads,
          channels: 1
      };
      
      const initialState = {
        campaignId,
        status: 'running',
        totalCalls: remainingLeads.length,
        completedCalls: 0,
        successfulCalls: 0,
        leads: remainingLeads
      };
      
      await redis.set('campaign-state:' + companyId, JSON.stringify(initialState));
      await queue.add(campaignId, data, { jobId: campaignId, removeOnComplete: true, removeOnFail: true });
      console.log('Successfully re-queued the remaining calls!');
  } else {
      console.log('No remaining calls needed.');
  }
  process.exit(0);
}
run();

