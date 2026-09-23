import { PrismaClient } from "@prisma/client";
import { redisConnection } from "./src/server/redis";
import { startCampaignJob } from "./src/server/queues/campaign-execution.queue";

async function main() {
  const keys = await redisConnection.keys("campaign-state:*");
  for (const k of keys) {
    if (k.includes("paused")) continue;
    const stateStr = await redisConnection.get(k);
    if (!stateStr) continue;
    
    let state = JSON.parse(stateStr);
    
    // Resume Reactivation campaigns that got stuck
    if (state.status === "force_stopped" && state.isReactivation) {
      console.log(`Resuming Reactivation Campaign: ${state.campaignId}...`);
      
      const remainingLeads = state.leads.filter((l: any) => !l.called);
      console.log(`Found ${remainingLeads.length} remaining leads out of ${state.totalContacts}`);
      
      if (remainingLeads.length > 0) {
        const companyId = k.split(":")[1];
        
        // We need to find the DID number from the DB to get the channel limit
        const prisma = new PrismaClient();
        const logs = await prisma.callLog.findFirst({
           where: { correlationId: state.campaignId }
        });
        
        const didNumber = logs?.historicalDidString || "";
        const channels = logs?.historicalChannels || 2;
        
        await startCampaignJob({
          companyId: companyId,
          campaignId: state.campaignId,
          didNumber: didNumber,
          channels: channels,
          leads: remainingLeads,
          isReactivation: true,
          qStage: state.qStage,
          allOriginalLeads: state.allOriginalLeads
        });
        
        console.log("Successfully enqueued remaining calls!");
      } else {
        console.log("No remaining leads to call.");
      }
    }
  }
}
main().catch(console.error).finally(() => process.exit(0));
