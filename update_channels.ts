
import Redis from 'ioredis';

const redis = new Redis('redis://:Propnexai@123@200.234.34.240:6379');

async function run() {
  const companyId = '6a8bed4d3f5b7c2eea48418e';
  const campaignId = 'reactivation-2026-09-19-6a8bed4d-350798-q2';
  
  const stateStr = await redis.get('campaign-state:' + companyId);
  if (stateStr) {
      const state = JSON.parse(stateStr);
      state.channels = 2; // Force to 2 channels
      await redis.set('campaign-state:' + companyId, JSON.stringify(state));
      console.log('Updated campaign state to 2 channels!');
  } else {
      console.log('Campaign state not found.');
  }
  
  process.exit(0);
}
run();

