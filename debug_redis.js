const Redis = require('ioredis');
require('dotenv').config();

async function main() {
  const redis = new Redis(process.env.REDIS_URL);
  const stateStr = await redis.get('campaign-state:6a8bed4d3f5b7c2eea48418e');
  console.log("Current State:", stateStr);
  
  // Also check if there's any paused state or active campaign
  const keys = await redis.keys('campaign-state*');
  console.log("All campaign state keys:", keys);
}
main().catch(console.error).finally(() => process.exit(0));
