import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const companyId = "6a86c29fae5fc55d68a902e2";
  
  // Find all inbound calls for this company
  const calls = await prisma.callLog.findMany({
    where: { companyId, direction: "INBOUND" }
  });

  let deletedCount = 0;
  for (const call of calls) {
    // If it's a webhook call, check the callid
    if (call.providerWebhook) {
      const webhook = call.providerWebhook as any;
      const agentNumber = webhook.callid || webhook.calledno;
      
      // If the webhook agent number doesn't match the assigned number 919429390765
      if (agentNumber !== "919429390765") {
        await prisma.callLog.delete({
          where: { id: call.id }
        });
        deletedCount++;
      }
    }
  }

  console.log(`Deleted ${deletedCount} incorrectly assigned inbound calls from the local database.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
