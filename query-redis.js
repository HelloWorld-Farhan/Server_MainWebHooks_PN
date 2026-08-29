const Redis = require('ioredis');
require('dotenv').config();

async function main() {
  const redis = new Redis(process.env.REDIS_URL);
  const keys = await redis.keys('campaign-state:*');
  for (const key of keys) {
    const state = await redis.get(key);
    console.log(`Key: ${key}`);
    console.log(state);
    console.log('---');
    
    // forcefully update status to completed if stuck
    const stateObj = JSON.parse(state);
    if (stateObj && stateObj.status === 'running') {
      stateObj.status = 'completed';
      if (!stateObj.failedCalls) stateObj.failedCalls = 1;
      if (!stateObj.completedCalls) stateObj.completedCalls = 1;
      await redis.set(key, JSON.stringify(stateObj));
      console.log(`Forcefully updated ${key} to completed`);
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
