require("dotenv").config();
const Redis = require("ioredis");
const { Queue } = require("bullmq");
const { PrismaClient } = require("@prisma/client");

async function main() {
  const redis = new Redis(process.env.REDIS_URL);
  const queue = new Queue("campaign-execution-queue", { connection: redis });
  await queue.obliterate({ force: true });
  console.log("Queue obliterated!");
  
  const keys = await redis.keys("campaign-state:*");
  for (const k of keys) {
    if (k.includes("paused")) continue;
    await redis.del(k);
  }
  
  const prisma = new PrismaClient();
  await prisma.callLog.updateMany({
    where: { status: { in: ["RINGING", "PENDING", "QUEUED"] } },
    data: { status: "FAILED" }
  });
  
  await prisma.$disconnect();
  await redis.quit();
}
main().catch(console.error);
