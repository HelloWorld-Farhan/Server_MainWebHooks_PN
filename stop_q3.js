require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const Redis = require("ioredis");
const { Queue } = require("bullmq");

async function main() {
  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("No REDIS_URL found");
  
  const redis = new Redis(redisUrl);
  const queue = new Queue("campaign-execution-queue", { connection: redis });
  
  // Stop Q3
  const keys = await redis.keys("campaign-state:*");
  for (const k of keys) {
    if (k.includes("paused")) continue;
    const stateStr = await redis.get(k);
    if (!stateStr) continue;
    
    let state = JSON.parse(stateStr);
    
    // Stop the incorrectly resumed Q3
    if (state.status === "running" && state.isReactivation && state.qStage === "Q3") {
      console.log(`Force stopping Q3: ${k}...`);
      state.status = "force_stopped";
      await redis.set(k, JSON.stringify(state));
      
      if (state.activeJobId) {
        console.log(`Attempting to remove BullMQ job: ${state.activeJobId}`);
        try {
          const job = await queue.getJob(state.activeJobId);
          if (job) await job.remove();
        } catch (e) {
          console.log(`Could not remove job (likely locked and running). The worker will naturally abort when it sees force_stopped.`);
        }
      }
    }
  }

  // Resume Q2
  for (const k of keys) {
    if (k.includes("paused")) continue;
    const stateStr = await redis.get(k);
    if (!stateStr) continue;
    
    let state = JSON.parse(stateStr);
    
    // If it's Q2 and not completed, resume it
    if (state.isReactivation && state.qStage === "Q2" && state.status !== "completed") {
      console.log(`Resuming Q2 Campaign: ${k}, Current Status: ${state.status}`);
      
      const remainingLeads = state.leads.filter((l) => !l.called);
      console.log(`Found ${remainingLeads.length} remaining leads out of ${state.totalContacts}`);
      
      if (remainingLeads.length > 0) {
        const companyId = k.split(":")[1];
        
        const logs = await prisma.callLog.findFirst({
           where: { correlationId: state.campaignId }
        });
        
        const didNumber = logs?.historicalDidString || "";
        const channels = logs?.historicalChannels || 2;
        const uniqueJobId = `campaign-${companyId}-${Date.now()}`;
        
        const jobData = {
          companyId: companyId,
          campaignId: state.campaignId,
          didNumber: didNumber,
          channels: channels,
          leads: state.leads,
          isReactivation: true,
          qStage: state.qStage,
          allOriginalLeads: state.allOriginalLeads
        };

        state.status = "running";
        state.activeJobId = uniqueJobId;
        await redis.set(k, JSON.stringify(state));

        await queue.add(uniqueJobId, jobData, {
          jobId: uniqueJobId,
          removeOnComplete: true,
          removeOnFail: true,
        });
        
        console.log("Successfully enqueued Q2!");
      }
    }
  }
  
  await prisma.callLog.updateMany({
    where: { status: { in: ["RINGING", "PENDING", "QUEUED"] } },
    data: { status: "FAILED" }
  });

  console.log("Done!");
  await prisma.$disconnect();
  await redis.quit();
  await queue.close();
}

main().catch(console.error);
