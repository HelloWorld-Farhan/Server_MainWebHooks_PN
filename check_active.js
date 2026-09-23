require("dotenv").config();
const Redis = require("ioredis");
const { Queue } = require("bullmq");

async function main() {
  const redis = new Redis(process.env.REDIS_URL);
  const queue = new Queue("campaign-execution-queue", { connection: redis });
  const active = await queue.getActive();
  
  console.log(`Active Jobs: ${active.length}`);
  for (const job of active) {
    console.log(`Job ${job.id}:`);
    const stateStr = await redis.get(`campaign-state:${job.data.companyId}`);
    if (stateStr) {
      console.log(stateStr);
    }
  }
  await redis.quit();
  await queue.close();
}
main().catch(console.error);
