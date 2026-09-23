require("dotenv").config();
const Redis = require("ioredis");
const { Queue } = require("bullmq");
async function main() {
  const redis = new Redis(process.env.REDIS_URL);
  const queue = new Queue("campaign-execution-queue", { connection: redis });
  const counts = await queue.getJobCounts();
  console.log("Queue counts:", counts);
  const delayed = await queue.getDelayed();
  console.log("Delayed jobs:", delayed.map(j => ({ id: j.id, name: j.name, timestamp: new Date(j.timestamp).toLocaleString(), delay: j.opts.delay })));
  const waiting = await queue.getWaiting();
  console.log("Waiting jobs:", waiting.map(j => ({ id: j.id, name: j.name })));
  const active = await queue.getActive();
  console.log("Active jobs:", active.map(j => ({ id: j.id, name: j.name })));
  process.exit(0);
}
main().catch(console.error);
