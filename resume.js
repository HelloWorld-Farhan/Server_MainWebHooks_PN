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
  
  const keys = await redis.keys("campaign-state:*");
  for (const k of keys) {
    if (k.includes("paused")) continue;
    const stateStr = await redis.get(k);
    if (!stateStr) continue;
    
    let state = JSON.parse(stateStr);
    
    // Resume Reactivation campaigns that got stuck
    if (state.status === "force_stopped" && state.isReactivation) {
      console.log(`Resuming Reactivation Campaign: ${state.campaignId}...`);
      
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
          leads: state.leads, // Pass all leads so history is preserved
          isReactivation: true,
          qStage: state.qStage,
          allOriginalLeads: state.allOriginalLeads
        };

        // Update state back to running
        state.status = "running";
        state.activeJobId = uniqueJobId;
        await redis.set(k, JSON.stringify(state));

        // Enqueue to BullMQ
        await queue.add(uniqueJobId, jobData, {
          jobId: uniqueJobId,
          removeOnComplete: true,
          removeOnFail: true,
        });
        
        console.log("Successfully enqueued remaining calls into BullMQ!");
      } else {
        console.log("No remaining leads to call.");
      }
    }
  }
  
  console.log("Resume process complete!");
  await prisma.$disconnect();
  await redis.quit();
  await queue.close();
}

main().catch(console.error);
