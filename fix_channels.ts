
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');
const queue = new Queue('campaign-execution-queue', { connection: redis });

async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  const campaignId = 'reactivation-2026-09-19-6a8bed4d-350798-q2';
  
  // Try to remove it first
  await queue.remove(campaignId);
  
  // Re-queue with channels: 2
  const stateStr = await redis.get('campaign-state:' + companyId);
  if (stateStr) {
      const state = JSON.parse(stateStr);
      const data = {
          companyId,
          campaignId,
          isReactivation: true,
          qStage: 'Q2',
          leads: state.leads || [],
          channels: 2
      };
      
      // Keep state as is, just queue it again
      await queue.add(campaignId, data, { jobId: campaignId, removeOnComplete: true, removeOnFail: true });
      console.log('Successfully updated job with channels: 2!');
  }
  
  process.exit(0);
}
run();

